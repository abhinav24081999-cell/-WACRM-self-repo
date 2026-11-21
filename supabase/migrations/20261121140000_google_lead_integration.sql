ALTER TABLE public.leads ADD COLUMN source_event_key text;
CREATE UNIQUE INDEX leads_source_event_key_idx ON public.leads (account_id, source_event_key)
  WHERE source_event_key IS NOT NULL;

CREATE FUNCTION public.match_form_contact(p_account_id uuid, p_name text, p_phone text, p_email text)
RETURNS uuid LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_contact_id uuid;
  v_owner_id uuid;
  v_phone_normalized text := regexp_replace(p_phone, '[^0-9]', '', 'g');
BEGIN
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
  RETURN v_contact_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_meta_form_lead(
  p_account_id uuid, p_lead_id text, p_name text, p_phone text, p_email text, p_attribution jsonb,
  p_form_answers jsonb
)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_contact_id uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    concat_ws(':', p_account_id, 'leadgen', p_lead_id), 0));
  IF EXISTS (SELECT 1 FROM public.leads WHERE account_id = p_account_id
    AND meta_event_key = 'meta_instant_form:' || p_lead_id) THEN RETURN; END IF;

  v_contact_id := public.match_form_contact(p_account_id, p_name, p_phone, p_email);
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

CREATE FUNCTION public.record_google_or_website_lead(
  p_account_id uuid, p_source text, p_event_id text, p_name text, p_phone text, p_email text,
  p_ads_platform text, p_attribution jsonb, p_form_answers jsonb
)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_event_key text := p_source || ':' || p_event_id;
  v_contact_id uuid;
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('google_lead_form', 'website_form')
     OR p_event_id IS NULL OR char_length(p_event_id) NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION 'Invalid lead source or event ID' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    concat_ws(':', p_account_id, v_event_key), 0));
  IF EXISTS (SELECT 1 FROM public.leads WHERE account_id = p_account_id
    AND source_event_key = v_event_key) THEN RETURN; END IF;

  v_contact_id := public.match_form_contact(p_account_id, p_name, p_phone, p_email);
  INSERT INTO public.leads (
    account_id, contact_id, title, source, ads_platform, attribution, form_answers, source_event_key
  ) VALUES (
    p_account_id, v_contact_id,
    CASE p_source WHEN 'google_lead_form' THEN 'Google Lead Form submission' ELSE 'Website form submission' END,
    p_source, p_ads_platform, p_attribution || jsonb_build_object('external_lead_id', p_event_id, 'webhook_source', p_source),
    p_form_answers, v_event_key
  );
END;
$$;

CREATE FUNCTION public.preserve_imported_form_id()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.attribution := NEW.attribution || jsonb_build_object(
    'external_lead_id', substring(OLD.source_event_key from strpos(OLD.source_event_key, ':') + 1),
    'webhook_source', split_part(OLD.source_event_key, ':', 1));
  RETURN NEW;
END;
$$;

CREATE TRIGGER preserve_imported_form_id
  BEFORE UPDATE OF attribution ON public.leads
  FOR EACH ROW WHEN (OLD.source_event_key IS NOT NULL)
  EXECUTE FUNCTION public.preserve_imported_form_id();

REVOKE ALL ON FUNCTION public.match_form_contact(uuid, text, text, text),
  public.record_google_or_website_lead(uuid, text, text, text, text, text, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_form_contact(uuid, text, text, text),
  public.record_google_or_website_lead(uuid, text, text, text, text, text, text, jsonb, jsonb)
  TO service_role;
