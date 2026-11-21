ALTER TABLE public.conversations
  ADD COLUMN channel text NOT NULL DEFAULT 'whatsapp',
  ADD COLUMN channel_account_id text,
  ADD COLUMN channel_account_label text,
  ADD COLUMN channel_sender_id text,
  ADD CONSTRAINT conversations_channel_fields CHECK (
    (channel = 'whatsapp' AND channel_account_id IS NULL
      AND channel_account_label IS NULL AND channel_sender_id IS NULL)
    OR (channel IN ('instagram', 'messenger') AND channel_account_id IS NOT NULL
      AND channel_account_label IS NOT NULL AND channel_sender_id IS NOT NULL)
  );

DROP INDEX public.idx_conversations_account_contact;
CREATE UNIQUE INDEX idx_conversations_account_contact
  ON public.conversations (account_id, contact_id) WHERE channel = 'whatsapp';
CREATE UNIQUE INDEX idx_conversations_social_identity
  ON public.conversations (account_id, channel, channel_account_id, channel_sender_id)
  WHERE channel <> 'whatsapp';

CREATE FUNCTION public.guard_social_conversation_route()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.channel <> 'whatsapp' THEN
        RAISE EXCEPTION 'Social conversation routes are set by the server' USING ERRCODE = '42501';
      END IF;
    ELSIF (NEW.channel, NEW.channel_account_id, NEW.channel_account_label, NEW.channel_sender_id)
      IS DISTINCT FROM (OLD.channel, OLD.channel_account_id, OLD.channel_account_label, OLD.channel_sender_id)
      OR (OLD.channel <> 'whatsapp' AND NEW.account_id IS DISTINCT FROM OLD.account_id) THEN
      RAISE EXCEPTION 'Social conversation routes are set by the server' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.channel <> 'whatsapp'
    AND (TG_OP = 'INSERT' OR NEW.contact_id IS DISTINCT FROM OLD.contact_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.contacts WHERE id = NEW.contact_id AND account_id = NEW.account_id
    ) THEN
    RAISE EXCEPTION 'Social contact must belong to the conversation workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_social_conversation_route
  BEFORE INSERT OR UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.guard_social_conversation_route();

CREATE FUNCTION public.record_social_message(
  p_account_id uuid, p_channel text, p_channel_account_id text,
  p_channel_account_label text, p_sender_id text, p_message_id text,
  p_text text, p_sent_at timestamptz, p_outgoing boolean, p_agent_id uuid,
  p_contact_name text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_owner_id uuid;
  v_contact_id uuid;
  v_conversation_id uuid;
  v_message_id uuid;
  v_provider_message_id text := p_channel || ':' || p_message_id;
BEGIN
  IF p_channel NOT IN ('instagram', 'messenger') THEN
    RAISE EXCEPTION 'Invalid social channel';
  END IF;

  -- Serializes the first message and any provider retries for this thread.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    concat_ws(':', p_account_id, p_channel, p_channel_account_id, p_sender_id), 0));

  SELECT id INTO v_conversation_id FROM public.conversations
  WHERE account_id = p_account_id AND channel = p_channel
    AND channel_account_id = p_channel_account_id AND channel_sender_id = p_sender_id;

  IF v_conversation_id IS NULL THEN
    IF p_outgoing THEN RETURN NULL; END IF;

    SELECT owner_user_id INTO STRICT v_owner_id FROM public.accounts WHERE id = p_account_id;

    INSERT INTO public.contacts (account_id, user_id, phone, name)
    VALUES (p_account_id, v_owner_id, '', p_contact_name)
    RETURNING id INTO v_contact_id;

    INSERT INTO public.conversations (
      account_id, user_id, contact_id, channel, channel_account_id,
      channel_account_label, channel_sender_id, first_inbound_at, ai_autoreply_disabled
    )
    VALUES (
      p_account_id, v_owner_id, v_contact_id, p_channel, p_channel_account_id,
      p_channel_account_label, p_sender_id, p_sent_at, true
    )
    RETURNING id INTO v_conversation_id;
  END IF;

  INSERT INTO public.messages (
    conversation_id, sender_type, sender_id, content_type, content_text, message_id, created_at
  )
  VALUES (
    v_conversation_id, CASE WHEN p_outgoing THEN 'agent' ELSE 'customer' END,
    p_agent_id, 'text', p_text, v_provider_message_id, p_sent_at
  )
  ON CONFLICT (conversation_id, message_id) DO NOTHING
  RETURNING id INTO v_message_id;

  IF v_message_id IS NULL THEN
    IF p_agent_id IS NOT NULL THEN
      UPDATE public.messages SET sender_id = p_agent_id
      WHERE conversation_id = v_conversation_id AND message_id = v_provider_message_id
        AND sender_type = 'agent' AND sender_id IS NULL;
    END IF;
    SELECT id INTO v_message_id FROM public.messages
    WHERE conversation_id = v_conversation_id AND message_id = v_provider_message_id;
    RETURN v_message_id;
  END IF;

  UPDATE public.conversations
  SET last_message_text = CASE WHEN last_message_at IS NULL OR p_sent_at >= last_message_at
                              THEN p_text ELSE last_message_text END,
      last_message_at = greatest(last_message_at, p_sent_at),
      unread_count = coalesce(unread_count, 0) + CASE WHEN p_outgoing THEN 0 ELSE 1 END,
      status = CASE WHEN NOT p_outgoing AND status = 'closed'
                    AND (closed_at IS NULL OR p_sent_at > closed_at)
                    THEN 'open' ELSE status END
  WHERE id = v_conversation_id;

  RETURN v_message_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_social_message(
  uuid, text, text, text, text, text, text, timestamptz, boolean, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_social_message(
  uuid, text, text, text, text, text, text, timestamptz, boolean, uuid, text
) TO service_role;
