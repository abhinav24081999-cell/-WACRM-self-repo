ALTER TABLE public.messages ADD COLUMN ai_reply_claimed_at timestamptz;

CREATE FUNCTION public.claim_inbound_ai_reply(
  p_account_id uuid,
  p_conversation_id uuid,
  p_message_id text,
  p_max_replies integer,
  p_sends_reply boolean
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_message_id uuid;
BEGIN
  PERFORM 1 FROM public.conversations
  WHERE id = p_conversation_id AND account_id = p_account_id
    AND NOT ai_autoreply_disabled AND assigned_agent_id IS NULL
    AND ai_reply_count < p_max_replies
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT id INTO v_message_id FROM public.messages
  WHERE conversation_id = p_conversation_id AND sender_type = 'customer'
  ORDER BY created_at DESC, id DESC LIMIT 1;

  UPDATE public.messages SET ai_reply_claimed_at = now()
  WHERE id = v_message_id AND message_id = p_message_id AND ai_reply_claimed_at IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;

  IF p_sends_reply THEN
    UPDATE public.conversations SET ai_reply_count = ai_reply_count + 1
    WHERE id = p_conversation_id;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_inbound_ai_reply(uuid, uuid, text, integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_inbound_ai_reply(uuid, uuid, text, integer, boolean)
  TO service_role;

ALTER TABLE public.ai_configs ADD COLUMN auto_reply_channels text[] NOT NULL
  DEFAULT ARRAY['whatsapp']::text[]
  CHECK (auto_reply_channels <@ ARRAY['whatsapp', 'instagram', 'messenger']::text[]
    AND array_position(auto_reply_channels, NULL) IS NULL);

CREATE FUNCTION public.enable_ai_for_new_social_conversation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.ai_configs
    WHERE account_id = NEW.account_id AND is_active AND auto_reply_enabled
      AND NEW.channel = ANY(auto_reply_channels)
  ) THEN
    NEW.ai_autoreply_disabled := false;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enable_ai_for_new_social_conversation() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enable_ai_for_new_social_conversation
  BEFORE INSERT ON public.conversations FOR EACH ROW
  WHEN (NEW.channel IN ('instagram', 'messenger') AND NEW.ai_autoreply_disabled)
  EXECUTE FUNCTION public.enable_ai_for_new_social_conversation();
