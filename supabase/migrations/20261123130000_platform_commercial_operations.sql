CREATE TABLE public.workspace_subscriptions (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  access_type text NOT NULL CHECK (access_type IN ('free','trial','paid','lifetime')),
  billing_cycle text,
  starts_on date NOT NULL,
  ends_on date,
  suspended boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  CHECK ((access_type IN ('trial','paid') AND ends_on IS NOT NULL AND ends_on >= starts_on)
    OR (access_type IN ('free','lifetime') AND ends_on IS NULL)),
  CHECK ((access_type = 'paid' AND billing_cycle IS NOT NULL AND billing_cycle IN ('monthly','yearly'))
    OR (access_type <> 'paid' AND billing_cycle IS NULL))
);

CREATE TABLE public.workspace_payments (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  amount_paise integer NOT NULL CHECK (amount_paise > 0),
  received_on date NOT NULL,
  reference text CHECK (char_length(reference) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL,
  voided_at timestamptz,
  voided_by uuid
);
CREATE INDEX workspace_payments_account_idx ON public.workspace_payments(account_id, received_on DESC, id);
CREATE INDEX workspace_payments_month_idx ON public.workspace_payments(received_on) WHERE voided_at IS NULL;
CREATE UNIQUE INDEX workspace_payment_reference ON public.workspace_payments(account_id, lower(reference))
WHERE reference IS NOT NULL AND voided_at IS NULL;

CREATE TABLE public.workspace_commercial_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('subscription_saved','payment_recorded','payment_voided')),
  change jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspace_commercial_audit_lookup ON public.workspace_commercial_audit(account_id, created_at DESC);

ALTER TABLE public.workspace_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_commercial_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_subscriptions, public.workspace_payments, public.workspace_commercial_audit
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.workspace_subscriptions, public.workspace_payments TO service_role;
GRANT SELECT, INSERT ON public.workspace_commercial_audit TO service_role;

CREATE FUNCTION private.commercial_today()
RETURNS date LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date; $$;

CREATE FUNCTION private.workspace_access_state(p_account uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN suspended THEN 'suspended'
      WHEN starts_on > private.commercial_today() THEN 'scheduled'
      WHEN ends_on < private.commercial_today() THEN 'expired'
      WHEN access_type = 'trial' THEN 'trial'
      ELSE 'active'
    END
    FROM public.workspace_subscriptions WHERE account_id = p_account
  ), 'active');
$$;

CREATE OR REPLACE FUNCTION public.is_account_member(
  target_account_id uuid, min_role public.account_role_enum DEFAULT 'viewer'
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND p.account_role <= min_role
  ) AND private.workspace_access_state(target_account_id) IN ('active','trial');
$$;

CREATE OR REPLACE FUNCTION public.workspace_feature_allowed(p_account_id uuid, p_feature text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT private.workspace_access_state(p_account_id) IN ('active','trial')
    AND (auth.uid() IS NULL OR public.is_account_member(p_account_id))
    AND COALESCE((
      SELECT p_feature = ANY(COALESCE(s.features, p.features))
      FROM public.workspace_plan_settings s
      JOIN public.platform_plans p ON p.id = s.plan_id
      WHERE s.account_id = p_account_id
    ), true);
$$;

CREATE FUNCTION public.current_workspace_access()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT private.workspace_access_state(p.account_id) FROM public.profiles p WHERE p.user_id = auth.uid(); $$;
REVOKE EXECUTE ON FUNCTION public.current_workspace_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_workspace_access() TO authenticated;

CREATE FUNCTION private.guard_restricted_membership_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.current_workspace_access() IN ('expired','suspended','scheduled') THEN
    RAISE EXCEPTION 'Workspace access is restricted' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.guard_restricted_membership_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_restricted_membership_change
  BEFORE UPDATE OF account_id, account_role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.guard_restricted_membership_change();

CREATE FUNCTION public.platform_commercial_snapshot(p_account_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', a.id, 'name', a.name, 'owner_id', a.owner_user_id, 'today', private.commercial_today(),
    'status', private.workspace_access_state(a.id),
    'subscription', (SELECT to_jsonb(s) FROM public.workspace_subscriptions s WHERE s.account_id = a.id),
    'payments', COALESCE((
      SELECT jsonb_agg(to_jsonb(pay) ORDER BY pay.received_on DESC, pay.created_at DESC, pay.id)
      FROM (SELECT id, amount_paise, received_on, reference, created_at, voided_at
        FROM public.workspace_payments WHERE account_id = a.id
        ORDER BY received_on DESC, created_at DESC, id LIMIT 30) pay
    ), '[]'::jsonb),
    'audit', COALESCE((
      SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry.created_at DESC, entry.id)
      FROM (
        SELECT log.id, log.action, log.created_at, COALESCE(NULLIF(actor.full_name,''),actor.email) AS actor
        FROM public.workspace_commercial_audit log
        LEFT JOIN public.profiles actor ON log.actor_id = actor.user_id
        WHERE log.account_id = a.id ORDER BY log.created_at DESC, log.id LIMIT 12
      ) entry
    ), '[]'::jsonb),
    'usage', jsonb_build_object(
      'messages', (SELECT count(*) FROM public.messages m JOIN public.conversations c ON c.id = m.conversation_id
        WHERE c.account_id = a.id AND m.created_at >= now() - interval '30 days'),
      'ai', (SELECT count(*) FROM public.ai_usage_log WHERE account_id = a.id AND created_at >= now() - interval '30 days'),
      'capi', (SELECT count(*) FROM public.conversion_feedback_events WHERE account_id = a.id AND created_at >= now() - interval '30 days')
    )
  ) FROM public.accounts a WHERE a.id = p_account_id;
$$;

CREATE FUNCTION public.platform_commercial_totals()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'revenue_paise', COALESCE((SELECT sum(amount_paise) FROM public.workspace_payments
      WHERE received_on >= date_trunc('month', private.commercial_today()::timestamp)::date
        AND received_on <= private.commercial_today() AND voided_at IS NULL), 0),
    'active_paid', (SELECT count(*) FROM public.workspace_subscriptions s
      WHERE access_type = 'paid' AND private.workspace_access_state(s.account_id) = 'active'),
    'trials', (SELECT count(*) FROM public.workspace_subscriptions s
      WHERE access_type = 'trial' AND private.workspace_access_state(s.account_id) = 'trial')
  );
$$;

CREATE FUNCTION public.platform_save_commercial(
  p_account_id uuid, p_actor_id uuid, p_action text, p_payload jsonb
)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
  v_payment uuid;
  v_amount integer;
  v_received date;
  v_reference text;
  v_old jsonb;
  v_pay public.workspace_payments;
BEGIN
  SELECT owner_user_id INTO v_owner FROM public.accounts WHERE id = p_account_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN 'workspace_missing'; END IF;
  IF p_actor_id = v_owner AND p_action = 'subscription_saved' THEN RETURN 'platform_owner'; END IF;

  IF p_action = 'subscription_saved' THEN
    SELECT to_jsonb(s) INTO v_old FROM public.workspace_subscriptions s WHERE account_id = p_account_id;
    IF (v_old->>'updated_at')::timestamptz IS DISTINCT FROM (p_payload->>'expected_updated_at')::timestamptz THEN
      RETURN 'conflict';
    END IF;
    INSERT INTO public.workspace_subscriptions (account_id, access_type, billing_cycle, starts_on, ends_on, suspended, updated_by)
    VALUES (p_account_id, p_payload->>'access_type', p_payload->>'billing_cycle', (p_payload->>'starts_on')::date,
      (p_payload->>'ends_on')::date, (p_payload->>'suspended')::boolean, p_actor_id)
    ON CONFLICT (account_id) DO UPDATE SET access_type = EXCLUDED.access_type, billing_cycle = EXCLUDED.billing_cycle,
      starts_on = EXCLUDED.starts_on, ends_on = EXCLUDED.ends_on, suspended = EXCLUDED.suspended,
      updated_by = EXCLUDED.updated_by, updated_at = clock_timestamp();
    v_old := jsonb_build_object('before', v_old, 'after', p_payload - 'expected_updated_at');
  ELSIF p_action = 'payment_recorded' THEN
    v_payment := (p_payload->>'id')::uuid;
    v_amount := (p_payload->>'amount_paise')::integer;
    v_received := (p_payload->>'received_on')::date;
    v_reference := NULLIF(btrim(p_payload->>'reference'), '');
    IF v_received > private.commercial_today() THEN RETURN 'invalid_date'; END IF;
    INSERT INTO public.workspace_payments(id, account_id, amount_paise, received_on, reference, recorded_by)
    VALUES (v_payment, p_account_id, v_amount, v_received, v_reference, p_actor_id)
    ON CONFLICT (id) DO NOTHING;
    IF NOT FOUND THEN
      SELECT * INTO v_pay FROM public.workspace_payments WHERE id = v_payment;
      IF v_pay.account_id = p_account_id AND v_pay.amount_paise = v_amount AND v_pay.received_on = v_received
        AND v_pay.reference IS NOT DISTINCT FROM v_reference THEN RETURN 'saved'; END IF;
      RETURN 'conflict';
    END IF;
    v_old := p_payload;
  ELSIF p_action = 'payment_voided' THEN
    v_payment := (p_payload->>'id')::uuid;
    UPDATE public.workspace_payments SET voided_at = now(), voided_by = p_actor_id
    WHERE id = v_payment AND account_id = p_account_id AND voided_at IS NULL;
    IF NOT FOUND THEN RETURN 'payment_unavailable'; END IF;
    v_old := p_payload;
  ELSE RETURN 'bad_action';
  END IF;

  INSERT INTO public.workspace_commercial_audit(account_id, actor_id, action, change)
  VALUES (p_account_id, p_actor_id, p_action, v_old);
  RETURN 'saved';
END;
$$;

GRANT USAGE ON SCHEMA private TO service_role;
REVOKE EXECUTE ON FUNCTION private.commercial_today(), private.workspace_access_state(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.commercial_today(), private.workspace_access_state(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.platform_commercial_snapshot(uuid), public.platform_commercial_totals(),
  public.platform_save_commercial(uuid,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_commercial_snapshot(uuid), public.platform_commercial_totals(),
  public.platform_save_commercial(uuid,uuid,text,jsonb) TO service_role;

-- A configured subscription must survive an invitation to a different workspace.
CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_other_members BOOLEAN;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id
  FOR UPDATE OF p, a;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE account_id = v_old_account_id
      AND user_id <> v_caller_id
  ) INTO v_has_other_members;

  IF v_has_other_members THEN
    RAISE EXCEPTION 'Your account has other members; remove them or transfer ownership before joining another account'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_logs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_pending_executions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flow_runs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM deals WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM api_keys WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM webhook_endpoints WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM quick_replies WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM notifications WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_configs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_documents WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_chunks WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_usage_log WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM workspace_plan_settings WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM workspace_role_permissions WHERE account_id = v_old_account_id AND cardinality(denied) > 0
    UNION ALL SELECT 1 FROM workspace_subscriptions WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;
