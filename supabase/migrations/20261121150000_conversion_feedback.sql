CREATE SCHEMA IF NOT EXISTS private;

-- Restrict account cleanup while conversion configuration or history exists.
CREATE TABLE public.conversion_feedback_rules (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  source text NOT NULL,
  stage public.lead_status NOT NULL,
  destination text NOT NULL,
  delivery text NOT NULL CHECK (delivery IN ('automatic', 'manual', 'off')),
  test_mode boolean NOT NULL DEFAULT true,
  PRIMARY KEY (account_id, source, stage),
  CHECK (
    (source = 'meta_instant_form' AND stage IN ('new','qualified','converted')
      AND destination ~ '^[A-Za-z][A-Za-z0-9_]{0,39}$')
    OR (source IN ('whatsapp','instagram_dm','messenger') AND (
      (stage = 'new' AND destination = 'LeadSubmitted') OR (stage = 'qualified' AND destination = 'QualifiedLead')))
    OR (source IN ('google_lead_form','website_form') AND stage IN ('qualified','converted')
      AND destination ~ '^[1-9][0-9]{0,19}$')
  )
);

CREATE TABLE public.conversion_feedback_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  source text NOT NULL,
  stage public.lead_status NOT NULL,
  destination text NOT NULL,
  test_mode boolean NOT NULL,
  event_time timestamptz NOT NULL,
  identifiers jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('pending','sending','retrying','accepted','tested','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0,
  attempt_limit integer NOT NULL DEFAULT 5,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  reason text,
  response_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, lead_id, source, stage, test_mode)
);

CREATE INDEX conversion_feedback_events_due ON public.conversion_feedback_events (account_id, available_at)
  WHERE state IN ('pending','retrying','sending');
CREATE INDEX conversion_feedback_events_recent ON public.conversion_feedback_events (account_id, created_at DESC);

ALTER TABLE public.conversion_feedback_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversion_feedback_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversion_feedback_rules, public.conversion_feedback_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conversion_feedback_rules TO authenticated;
GRANT SELECT (id, account_id, lead_id, source, stage, destination, test_mode, event_time,
  state, attempts, reason, response_id, created_at) ON public.conversion_feedback_events TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.conversion_feedback_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.conversion_feedback_rules TO service_role;

CREATE POLICY conversion_feedback_rules_admin ON public.conversion_feedback_rules FOR SELECT TO authenticated
  USING (public.is_account_member(account_id, 'admin'));
CREATE POLICY conversion_feedback_events_admin ON public.conversion_feedback_events FOR SELECT TO authenticated
  USING (public.is_account_member(account_id, 'admin'));

CREATE FUNCTION private.enqueue_conversion_feedback(
  p_lead public.leads, p_stage public.lead_status, p_time timestamptz, p_automatic boolean
)
RETURNS uuid LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_rule public.conversion_feedback_rules%ROWTYPE;
  v_event_id uuid;
  v_ids jsonb;
  v_reason text;
  v_click text;
BEGIN
  SELECT * INTO v_rule FROM public.conversion_feedback_rules
  WHERE account_id = p_lead.account_id AND source = p_lead.source AND stage = p_stage;
  IF NOT FOUND OR v_rule.delivery = 'off' OR (p_automatic AND v_rule.delivery <> 'automatic') THEN RETURN NULL; END IF;

  CASE p_lead.source
    WHEN 'meta_instant_form' THEN
      v_ids := jsonb_build_object('lead_id', p_lead.attribution ->> 'external_lead_id');
      IF coalesce(v_ids ->> 'lead_id', '') !~ '^[0-9]{1,40}$' THEN v_reason := 'missing_meta_lead_id'; END IF;
    WHEN 'whatsapp' THEN
      v_ids := jsonb_build_object('ctwa_clid', p_lead.attribution ->> 'ctwa_clid',
        'whatsapp_business_account_id', p_lead.attribution ->> 'whatsapp_business_account_id');
      IF coalesce(v_ids ->> 'ctwa_clid', '') = '' OR coalesce(v_ids ->> 'whatsapp_business_account_id', '') !~ '^[0-9]{1,40}$' THEN
        v_reason := 'missing_whatsapp_identifiers';
      END IF;
    WHEN 'instagram_dm', 'messenger' THEN
      v_ids := jsonb_build_object('account_id', split_part(p_lead.meta_event_key, ':', 2),
        'sender_id', split_part(p_lead.meta_event_key, ':', 3));
      IF coalesce(v_ids ->> 'account_id', '') !~ '^[0-9]{1,40}$' OR coalesce(v_ids ->> 'sender_id', '') !~ '^[0-9]{1,40}$' THEN
        v_reason := 'missing_messaging_identifiers';
      END IF;
    WHEN 'website_form', 'google_lead_form' THEN
      v_ids := '{}'::jsonb;
      FOREACH v_click IN ARRAY ARRAY['gclid','gbraid','wbraid'] LOOP
        IF coalesce(p_lead.attribution ->> v_click, '') <> '' THEN
          v_ids := jsonb_build_object(v_click, p_lead.attribution ->> v_click);
          EXIT;
        END IF;
      END LOOP;
      IF p_lead.ads_platform IS DISTINCT FROM 'google' OR v_ids = '{}'::jsonb THEN
        v_reason := 'missing_google_click_id';
      ELSIF p_lead.source = 'google_lead_form' AND coalesce(p_lead.attribution ->> 'external_lead_id', '') <> '' THEN
        v_ids := v_ids || jsonb_build_object('leadId', p_lead.attribution ->> 'external_lead_id');
      END IF;
    ELSE RETURN NULL;
  END CASE;

  INSERT INTO public.conversion_feedback_events
    (account_id, lead_id, source, stage, destination, test_mode, event_time, identifiers, state, reason)
  VALUES (p_lead.account_id, p_lead.id, p_lead.source, p_stage, v_rule.destination, v_rule.test_mode, p_time,
    v_ids, CASE WHEN v_reason IS NULL THEN 'pending' ELSE 'skipped' END, v_reason)
  ON CONFLICT (account_id, lead_id, source, stage, test_mode) DO UPDATE
    SET identifiers = EXCLUDED.identifiers, state = 'pending', reason = NULL, destination = EXCLUDED.destination,
      available_at = now()
    WHERE conversion_feedback_events.state = 'skipped' AND conversion_feedback_events.attempts = 0
      AND EXCLUDED.state = 'pending'
  RETURNING id INTO v_event_id;
  RETURN coalesce(v_event_id, (SELECT id FROM public.conversion_feedback_events
    WHERE account_id = p_lead.account_id AND lead_id = p_lead.id AND source = p_lead.source
      AND stage = p_stage AND test_mode = v_rule.test_mode));
END;
$$;

CREATE FUNCTION private.queue_feedback_on_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_lead public.leads%ROWTYPE;
BEGIN
  IF NEW.status NOT IN ('new','qualified','converted') THEN RETURN NEW; END IF;
  SELECT * INTO STRICT v_lead FROM public.leads WHERE id = NEW.lead_id;
  PERFORM private.enqueue_conversion_feedback(v_lead, NEW.status, NEW.changed_at, true);
  RETURN NEW;
END;
$$;

CREATE TRIGGER queue_feedback_on_status_change AFTER INSERT ON public.lead_status_history
  FOR EACH ROW EXECUTE FUNCTION private.queue_feedback_on_status_change();

CREATE FUNCTION public.request_conversion_feedback(p_account_id uuid, p_lead_id uuid, p_stage public.lead_status, p_allow_live boolean)
RETURNS uuid LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_lead public.leads%ROWTYPE;
  v_time timestamptz;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id AND account_id = p_account_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.conversion_feedback_rules
  WHERE account_id = p_account_id AND source = v_lead.source AND stage = p_stage AND (test_mode OR p_allow_live)
  FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT min(changed_at) INTO v_time FROM public.lead_status_history WHERE lead_id = p_lead_id AND status = p_stage;
  IF v_time IS NULL THEN RETURN NULL; END IF;
  RETURN private.enqueue_conversion_feedback(v_lead, p_stage, v_time, false);
END;
$$;

CREATE FUNCTION public.claim_conversion_feedback(p_account_id uuid, p_allow_live boolean)
RETURNS SETOF public.conversion_feedback_events LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  UPDATE public.conversion_feedback_events SET state = 'failed', reason = 'retry_limit', lease_until = NULL
  WHERE account_id = p_account_id AND state = 'sending' AND attempts >= attempt_limit AND lease_until <= now();
  UPDATE public.conversion_feedback_events AS event SET state = 'skipped', reason = 'rule_changed', lease_until = NULL
  WHERE event.account_id = p_account_id AND (event.state IN ('pending','retrying') OR
    (event.state = 'sending' AND event.lease_until <= now()))
    AND NOT EXISTS (
      SELECT 1 FROM public.conversion_feedback_rules AS rule
      WHERE rule.account_id = event.account_id AND rule.source = event.source AND rule.stage = event.stage
        AND rule.destination = event.destination AND rule.test_mode = event.test_mode AND rule.delivery <> 'off'
    );
  RETURN QUERY WITH due AS (
    SELECT id FROM public.conversion_feedback_events
    WHERE account_id = p_account_id AND (test_mode OR p_allow_live) AND attempts < attempt_limit
      AND ((state IN ('pending','retrying') AND available_at <= now()) OR (state = 'sending' AND lease_until <= now()))
    ORDER BY available_at, id LIMIT 10 FOR UPDATE SKIP LOCKED
  ) UPDATE public.conversion_feedback_events AS event
  SET state = 'sending', attempts = event.attempts + 1, lease_until = now() + interval '2 minutes'
  FROM due WHERE event.id = due.id RETURNING event.*;
END;
$$;

CREATE FUNCTION public.retry_conversion_feedback(p_account_id uuid, p_event_id uuid, p_allow_live boolean)
RETURNS boolean LANGUAGE sql SET search_path = '' AS $$
  WITH queued AS (
    UPDATE public.conversion_feedback_events AS event
    SET state = 'pending', available_at = now(), attempt_limit = event.attempts + 5, reason = NULL
    WHERE event.account_id = p_account_id AND event.id = p_event_id AND event.state = 'failed'
      AND (event.test_mode OR p_allow_live)
      AND EXISTS (
        SELECT 1 FROM public.conversion_feedback_rules AS rule
        WHERE rule.account_id = event.account_id AND rule.source = event.source AND rule.stage = event.stage
          AND rule.destination = event.destination AND rule.test_mode = event.test_mode AND rule.delivery <> 'off'
      ) RETURNING id
  ) SELECT EXISTS (SELECT 1 FROM queued);
$$;

CREATE FUNCTION public.save_conversion_feedback_rule(
  p_account_id uuid, p_source text, p_stage public.lead_status, p_destination text,
  p_delivery text, p_test_mode boolean, p_allow_live boolean
)
RETURNS boolean LANGUAGE sql SET search_path = '' AS $$
  WITH saved AS (
    INSERT INTO public.conversion_feedback_rules (account_id, source, stage, destination, delivery, test_mode)
    SELECT p_account_id, p_source, p_stage, p_destination, p_delivery, p_test_mode
    WHERE p_test_mode OR p_allow_live
    ON CONFLICT (account_id, source, stage) DO UPDATE
      SET destination = EXCLUDED.destination, delivery = EXCLUDED.delivery, test_mode = EXCLUDED.test_mode
      WHERE conversion_feedback_rules.test_mode OR p_allow_live
    RETURNING account_id
  ) SELECT EXISTS (SELECT 1 FROM saved);
$$;

REVOKE ALL ON FUNCTION private.enqueue_conversion_feedback(public.leads, public.lead_status, timestamptz, boolean),
  private.queue_feedback_on_status_change(), public.request_conversion_feedback(uuid, uuid, public.lead_status, boolean),
  public.claim_conversion_feedback(uuid, boolean), public.retry_conversion_feedback(uuid, uuid, boolean),
  public.save_conversion_feedback_rule(uuid, text, public.lead_status, text, text, boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT EXECUTE ON FUNCTION private.enqueue_conversion_feedback(public.leads, public.lead_status, timestamptz, boolean),
  public.request_conversion_feedback(uuid, uuid, public.lead_status, boolean), public.claim_conversion_feedback(uuid, boolean),
  public.retry_conversion_feedback(uuid, uuid, boolean),
  public.save_conversion_feedback_rule(uuid, text, public.lead_status, text, text, boolean, boolean)
  TO service_role;
