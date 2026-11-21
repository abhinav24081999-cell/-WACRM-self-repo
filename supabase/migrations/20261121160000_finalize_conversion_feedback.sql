ALTER TABLE public.conversion_feedback_events
  DROP CONSTRAINT conversion_feedback_events_state_check,
  ADD CONSTRAINT conversion_feedback_events_state_check
    CHECK (state IN ('pending','sending','retrying','accepted','tested','failed','skipped','needs_review')),
  ADD COLUMN provider_target text,
  ADD COLUMN http_status integer,
  ADD COLUMN sent_at timestamptz;

GRANT SELECT (provider_target, http_status, sent_at) ON public.conversion_feedback_events TO authenticated;

UPDATE public.conversion_feedback_rules SET delivery = 'manual'
WHERE source IN ('whatsapp','instagram_dm','messenger') AND stage = 'new' AND delivery = 'automatic';
ALTER TABLE public.conversion_feedback_rules
  ADD CONSTRAINT messaging_new_requires_confirmation
    CHECK (source NOT IN ('whatsapp','instagram_dm','messenger') OR stage <> 'new' OR delivery <> 'automatic');

ALTER TABLE public.conversion_feedback_rules
  DROP CONSTRAINT conversion_feedback_rules_check,
  ADD CONSTRAINT conversion_feedback_rules_source_stage_check CHECK (
    (source = 'meta_instant_form' AND stage IN ('new','qualified','converted')
      AND destination ~ '^[A-Za-z][A-Za-z0-9_ ]{0,79}$')
    OR (source IN ('whatsapp','instagram_dm','messenger') AND (
      (stage = 'new' AND destination = 'LeadSubmitted') OR (stage = 'qualified' AND destination = 'QualifiedLead')))
    OR (source IN ('google_lead_form','website_form') AND stage IN ('qualified','converted')
      AND destination ~ '^[1-9][0-9]{0,19}$')
  );

CREATE OR REPLACE FUNCTION public.preserve_meta_form_lead_id()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.attribution := (NEW.attribution - 'provider_created_at') ||
    jsonb_build_object('external_lead_id', split_part(OLD.meta_event_key, ':', 2)) ||
    CASE WHEN OLD.attribution ? 'provider_created_at'
      THEN jsonb_build_object('provider_created_at', OLD.attribution ->> 'provider_created_at') ELSE '{}'::jsonb END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.enqueue_conversion_feedback(
  p_lead public.leads, p_stage public.lead_status, p_time timestamptz, p_automatic boolean
)
RETURNS uuid LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_rule public.conversion_feedback_rules%ROWTYPE;
  v_event_id uuid;
  v_ids jsonb;
  v_reason text;
  v_click text;
  v_prior record;
BEGIN
  SELECT * INTO v_rule FROM public.conversion_feedback_rules
  WHERE account_id = p_lead.account_id AND source = p_lead.source AND stage = p_stage;
  IF NOT FOUND OR v_rule.delivery = 'off' OR (p_automatic AND v_rule.delivery <> 'automatic') THEN RETURN NULL; END IF;
  IF p_lead.source IN ('meta_instant_form','whatsapp','instagram_dm','messenger')
      AND split_part(p_lead.meta_event_key, ':', 1) IS DISTINCT FROM p_lead.source THEN RETURN NULL; END IF;
  IF p_lead.source IN ('google_lead_form','website_form')
      AND split_part(p_lead.source_event_key, ':', 1) IS DISTINCT FROM p_lead.source THEN RETURN NULL; END IF;

  IF p_lead.source = 'meta_instant_form' AND p_stage <> 'new' THEN
    -- A later mapped milestone must wait for the raw lead in the same mode.
    FOR v_prior IN
      SELECT rule.stage, min(history.changed_at) AS happened
      FROM public.conversion_feedback_rules AS rule
      JOIN public.lead_status_history AS history ON history.lead_id = p_lead.id AND history.status = rule.stage
      WHERE rule.account_id = p_lead.account_id AND rule.source = p_lead.source
        AND rule.test_mode = v_rule.test_mode AND rule.delivery = 'automatic'
        AND (rule.stage = 'new' OR (p_stage = 'converted' AND rule.stage = 'qualified'))
      GROUP BY rule.stage
    LOOP
      PERFORM private.enqueue_conversion_feedback(p_lead, v_prior.stage, v_prior.happened, true);
    END LOOP;
  END IF;

  CASE p_lead.source
    WHEN 'meta_instant_form' THEN
      v_ids := jsonb_strip_nulls(jsonb_build_object('lead_id', p_lead.attribution ->> 'external_lead_id',
        'provider_created_at', p_lead.attribution ->> 'provider_created_at'));
      IF coalesce(v_ids ->> 'lead_id', '') !~ '^[0-9]{1,40}$' THEN v_reason := 'missing_meta_lead_id'; END IF;
    WHEN 'whatsapp' THEN
      v_ids := jsonb_build_object('ctwa_clid', p_lead.attribution ->> 'ctwa_clid',
        'whatsapp_business_account_id', p_lead.attribution ->> 'whatsapp_business_account_id');
      IF coalesce(v_ids ->> 'ctwa_clid', '') = '' OR coalesce(v_ids ->> 'whatsapp_business_account_id', '') !~ '^[0-9]{1,40}$'
        OR p_lead.meta_event_key <> 'whatsapp:click:' || (v_ids ->> 'ctwa_clid') THEN
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

CREATE OR REPLACE FUNCTION public.claim_conversion_feedback(p_account_id uuid, p_allow_live boolean)
RETURNS SETOF public.conversion_feedback_events LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- A previous worker might have sent the messaging event before losing the lease.
  UPDATE public.conversion_feedback_events
  SET state = 'needs_review', reason = 'messaging_delivery_uncertain', lease_until = NULL
  WHERE account_id = p_account_id AND source IN ('whatsapp','instagram_dm','messenger')
    AND state = 'sending' AND lease_until <= now() AND (test_mode OR p_allow_live);
  UPDATE public.conversion_feedback_events SET state = 'failed', reason = 'retry_limit', lease_until = NULL
  WHERE account_id = p_account_id AND (test_mode OR p_allow_live) AND state = 'sending' AND attempts >= attempt_limit AND lease_until <= now();
  UPDATE public.conversion_feedback_events AS event SET state = 'skipped', reason = 'rule_changed', lease_until = NULL
  WHERE event.account_id = p_account_id AND (event.test_mode OR p_allow_live) AND (event.state IN ('pending','retrying') OR
    (event.state = 'sending' AND event.lease_until <= now()))
    AND NOT EXISTS (
      SELECT 1 FROM public.conversion_feedback_rules AS rule
      WHERE rule.account_id = event.account_id AND rule.source = event.source AND rule.stage = event.stage
        AND rule.destination = event.destination AND rule.test_mode = event.test_mode AND rule.delivery <> 'off'
    );
  RETURN QUERY WITH due AS (
    SELECT candidate.id FROM public.conversion_feedback_events AS candidate
    WHERE candidate.account_id = p_account_id AND (candidate.test_mode OR p_allow_live) AND candidate.attempts < candidate.attempt_limit
      AND (
        candidate.source <> 'meta_instant_form' OR candidate.stage = 'new' OR EXISTS (
          SELECT 1 FROM public.conversion_feedback_events AS raw
          WHERE raw.account_id = candidate.account_id AND raw.lead_id = candidate.lead_id
            AND raw.source = candidate.source AND raw.stage = 'new' AND raw.test_mode = candidate.test_mode
            AND (raw.state = 'accepted' OR (raw.test_mode AND raw.state = 'tested'))
        )
      )
      AND (
        candidate.source <> 'meta_instant_form' OR candidate.stage <> 'converted' OR NOT EXISTS (
          SELECT 1 FROM public.conversion_feedback_rules AS prior
          JOIN public.lead_status_history AS history ON history.lead_id = candidate.lead_id AND history.status = prior.stage
          WHERE prior.account_id = candidate.account_id AND prior.source = candidate.source
            AND prior.stage = 'qualified' AND prior.test_mode = candidate.test_mode AND prior.delivery <> 'off'
            AND NOT EXISTS (
              SELECT 1 FROM public.conversion_feedback_events AS qualified
              WHERE qualified.account_id = candidate.account_id AND qualified.lead_id = candidate.lead_id
                AND qualified.source = candidate.source AND qualified.stage = prior.stage AND qualified.test_mode = prior.test_mode
                AND (qualified.state = 'accepted' OR (qualified.test_mode AND qualified.state = 'tested'))
            )
        )
      )
      AND ((state IN ('pending','retrying') AND available_at <= now()) OR (state = 'sending' AND lease_until <= now()))
    ORDER BY available_at, id LIMIT 10 FOR UPDATE SKIP LOCKED
  ) UPDATE public.conversion_feedback_events AS event
  SET state = 'sending', attempts = event.attempts + 1, lease_until = now() + interval '2 minutes'
  FROM due WHERE event.id = due.id RETURNING event.*;
END;
$$;
