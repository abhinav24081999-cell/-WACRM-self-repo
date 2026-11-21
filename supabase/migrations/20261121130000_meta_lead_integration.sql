ALTER TABLE public.leads ADD COLUMN meta_event_key text;
ALTER TABLE public.leads ADD COLUMN form_answers jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(form_answers) = 'array');
CREATE UNIQUE INDEX leads_meta_event_key_idx ON public.leads (account_id, meta_event_key)
  WHERE meta_event_key IS NOT NULL;

CREATE FUNCTION public.preserve_meta_form_lead_id()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.attribution := NEW.attribution || jsonb_build_object('external_lead_id', split_part(OLD.meta_event_key, ':', 2));
  RETURN NEW;
END;
$$;

CREATE TRIGGER preserve_meta_form_lead_id
  BEFORE UPDATE OF attribution ON public.leads
  FOR EACH ROW WHEN (OLD.meta_event_key LIKE 'meta_instant_form:%')
  EXECUTE FUNCTION public.preserve_meta_form_lead_id();

CREATE FUNCTION public.record_meta_lead(
  p_account_id uuid, p_contact_id uuid, p_source text, p_event_key text,
  p_attribution jsonb, p_source_detail text
)
RETURNS void LANGUAGE sql SET search_path = '' AS $$
  INSERT INTO public.leads
    (account_id, contact_id, title, source, source_detail, ads_platform, attribution, meta_event_key)
  VALUES (p_account_id, p_contact_id,
    CASE p_source
      WHEN 'whatsapp' THEN 'WhatsApp ad enquiry'
      WHEN 'instagram_dm' THEN 'Instagram ad enquiry'
      WHEN 'messenger' THEN 'Messenger ad enquiry'
      WHEN 'meta_instant_form' THEN 'Meta Instant Form submission'
    END,
    p_source, p_source_detail, 'meta', p_attribution, p_source || ':' || p_event_key)
  ON CONFLICT (account_id, meta_event_key) WHERE meta_event_key IS NOT NULL DO NOTHING;
$$;

CREATE FUNCTION public.record_meta_form_lead(
  p_account_id uuid, p_lead_id text, p_name text, p_phone text, p_email text, p_attribution jsonb,
  p_form_answers jsonb
)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_contact_id uuid;
  v_owner_id uuid;
  v_phone_normalized text := regexp_replace(p_phone, '[^0-9]', '', 'g');
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    concat_ws(':', p_account_id, 'leadgen', p_lead_id), 0));
  IF EXISTS (SELECT 1 FROM public.leads WHERE account_id = p_account_id
    AND meta_event_key = 'meta_instant_form:' || p_lead_id) THEN RETURN; END IF;

  IF v_phone_normalized <> '' THEN
    SELECT id INTO v_contact_id FROM public.contacts
    WHERE account_id = p_account_id AND phone_normalized = v_phone_normalized;
  ELSIF p_email <> '' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      concat_ws(':', p_account_id, 'lead-email', p_email), 0));
    SELECT (array_agg(id))[1] INTO v_contact_id FROM public.contacts
    WHERE account_id = p_account_id AND lower(email) = p_email HAVING count(*) = 1;
  END IF;

  IF v_contact_id IS NULL THEN
    SELECT owner_user_id INTO STRICT v_owner_id FROM public.accounts WHERE id = p_account_id;
    INSERT INTO public.contacts (account_id, user_id, phone, name, email)
    VALUES (p_account_id, v_owner_id, p_phone, nullif(p_name, ''), nullif(p_email, ''))
    ON CONFLICT (account_id, phone_normalized) WHERE phone_normalized <> '' DO NOTHING
    RETURNING id INTO v_contact_id;
    IF v_contact_id IS NULL THEN
      SELECT id INTO STRICT v_contact_id FROM public.contacts
      WHERE account_id = p_account_id AND phone_normalized = v_phone_normalized;
    END IF;
  END IF;

  IF p_name <> '' OR p_email <> '' THEN
    UPDATE public.contacts
    SET name = coalesce(nullif(name, ''), nullif(p_name, '')),
        email = coalesce(nullif(email, ''), nullif(p_email, ''))
    WHERE account_id = p_account_id AND id = v_contact_id
      AND ((p_name <> '' AND coalesce(name, '') = '') OR (p_email <> '' AND coalesce(email, '') = ''));
  END IF;

  PERFORM public.record_meta_lead(p_account_id, v_contact_id, 'meta_instant_form', p_lead_id,
    p_attribution || jsonb_build_object('external_lead_id', p_lead_id),
    CASE lower(p_attribution ->> 'meta_platform')
      WHEN 'fb' THEN 'Facebook Instant Form'
      WHEN 'facebook' THEN 'Facebook Instant Form'
      WHEN 'ig' THEN 'Instagram Instant Form'
      WHEN 'instagram' THEN 'Instagram Instant Form'
      ELSE 'Meta Instant Form'
    END);
  UPDATE public.leads SET form_answers = p_form_answers
  WHERE account_id = p_account_id AND meta_event_key = 'meta_instant_form:' || p_lead_id;
END;
$$;

CREATE FUNCTION public.record_meta_social_lead(
  p_account_id uuid, p_channel text, p_channel_account_id text, p_channel_account_label text,
  p_sender_id text, p_event_key text, p_attribution jsonb
)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_owner_id uuid;
  v_contact_id uuid;
BEGIN
  IF p_channel NOT IN ('instagram', 'messenger') THEN RAISE EXCEPTION 'Invalid social channel'; END IF;

  -- Use the inbox writer's lock so a referral and its first DM share a contact.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    concat_ws(':', p_account_id, p_channel, p_channel_account_id, p_sender_id), 0));
  SELECT contact_id INTO v_contact_id FROM public.conversations
  WHERE account_id = p_account_id AND channel = p_channel
    AND channel_account_id = p_channel_account_id AND channel_sender_id = p_sender_id;

  IF v_contact_id IS NULL THEN
    SELECT owner_user_id INTO STRICT v_owner_id FROM public.accounts WHERE id = p_account_id;
    INSERT INTO public.contacts (account_id, user_id, phone) VALUES (p_account_id, v_owner_id, '')
    RETURNING id INTO v_contact_id;
    INSERT INTO public.conversations (
      account_id, user_id, contact_id, channel, channel_account_id, channel_account_label,
      channel_sender_id, ai_autoreply_disabled
    ) VALUES (
      p_account_id, v_owner_id, v_contact_id, p_channel, p_channel_account_id, p_channel_account_label,
      p_sender_id, true
    );
  END IF;

  PERFORM public.record_meta_lead(p_account_id, v_contact_id,
    CASE p_channel WHEN 'instagram' THEN 'instagram_dm' ELSE p_channel END,
    concat_ws(':', p_channel_account_id, p_sender_id, p_event_key), p_attribution,
    CASE p_channel WHEN 'instagram' THEN 'Click to Instagram Direct' ELSE 'Click to Messenger' END);
END;
$$;

REVOKE ALL ON FUNCTION public.record_meta_lead(uuid, uuid, text, text, jsonb, text),
  public.record_meta_form_lead(uuid, text, text, text, text, jsonb, jsonb),
  public.record_meta_social_lead(uuid, text, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_meta_lead(uuid, uuid, text, text, jsonb, text),
  public.record_meta_form_lead(uuid, text, text, text, text, jsonb, jsonb),
  public.record_meta_social_lead(uuid, text, text, text, text, text, jsonb)
  TO service_role;

ALTER TABLE public.messages ADD COLUMN meta_ad_referral jsonb;

CREATE FUNCTION public.capture_whatsapp_ad_lead()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_conversation public.conversations%ROWTYPE;
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' AND NEW.meta_ad_referral IS NOT NULL
      OR TG_OP = 'UPDATE' AND NEW.meta_ad_referral IS DISTINCT FROM OLD.meta_ad_referral THEN
      RAISE EXCEPTION 'Ad referral data is set by the webhook' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.meta_ad_referral IS NOT NULL AND NEW.sender_type = 'customer' THEN
    SELECT * INTO STRICT v_conversation FROM public.conversations WHERE id = NEW.conversation_id;
    IF v_conversation.channel = 'whatsapp' THEN
      PERFORM public.record_meta_lead(v_conversation.account_id, v_conversation.contact_id, 'whatsapp',
        coalesce('click:' || (NEW.meta_ad_referral ->> 'ctwa_clid'), 'message:' || NEW.message_id),
        NEW.meta_ad_referral, 'Click to WhatsApp');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Roll the lead back with the message if either write fails.
CREATE TRIGGER capture_whatsapp_ad_lead
  AFTER INSERT OR UPDATE OF meta_ad_referral ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.capture_whatsapp_ad_lead();
