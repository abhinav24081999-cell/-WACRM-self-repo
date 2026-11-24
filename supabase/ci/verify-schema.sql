-- Post-migration assertions for the CI job in
-- `.github/workflows/migrations.yml`.
--
-- `supabase db reset` already fails on any statement Postgres rejects,
-- so this is not about syntax. It's about the quieter failure: a
-- migration that applies cleanly and does nothing. Every DDL statement
-- in this repo is guarded with IF NOT EXISTS / ON CONFLICT so the files
-- can be re-run safely, and that same guard turns a typo'd object name
-- into a silent no-op with a green checkmark.
--
-- Keep this thin. It is a smoke test for "did the migrations actually
-- build the schema", not a spec of it — asserting every column here
-- would just be the migrations restated in a second place, drifting.
DO $$
DECLARE
  v_customer uuid := gen_random_uuid();
  v_actor uuid := gen_random_uuid();
  v_workspace uuid;
  v_plan uuid;
  v_staff uuid := gen_random_uuid();
  v_payment uuid := gen_random_uuid();
  v_today date;
  v_payment_payload jsonb;
BEGIN
  -- The core tables, from 001.
  IF to_regclass('public.messages') IS NULL THEN
    RAISE EXCEPTION 'public.messages is missing — migrations did not apply';
  END IF;
  IF to_regclass('public.whatsapp_config') IS NULL THEN
    RAISE EXCEPTION 'public.whatsapp_config is missing — migrations did not apply';
  END IF;

  -- Supabase provides the storage schema; migrations 016/020/023 write
  -- to it. If it is absent the bucket migrations silently accomplish
  -- nothing, which is precisely the case a plain "no errors" run hides.
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION
      'storage.buckets is missing — the storage schema was not available when the bucket migrations ran';
  END IF;

  -- Buckets are UPSERTed, so their absence means the INSERT never ran.
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'chat-media') THEN
    RAISE EXCEPTION 'the chat-media bucket row was not created (migration 023)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'flow-media') THEN
    RAISE EXCEPTION 'the flow-media bucket row was not created (migration 016)';
  END IF;

  -- Account scoping (017) is load-bearing for every RLS policy.
  IF to_regclass('public.accounts') IS NULL THEN
    RAISE EXCEPTION 'public.accounts is missing — migration 017 did not apply';
  END IF;

  -- The BSUID index (040) is the only thing stopping a username-only
  -- WhatsApp sender from forking a new contact per inbound message. A
  -- typo in its name would apply cleanly and guarantee nothing.
  IF to_regclass('public.idx_contacts_account_wa_user_id') IS NULL THEN
    RAISE EXCEPTION
      'idx_contacts_account_wa_user_id is missing — migration 040 did not apply';
  END IF;

  -- 041 repairs create_broadcast_with_recipients, which 037/038 shipped
  -- with an ambiguous bare `RETURNING id, contact_id` (SQLSTATE 42702 on
  -- first call — plpgsql resolves names at execution, not CREATE, so a
  -- plain replay can't catch it). Assert the qualified form is what's
  -- actually installed.
  IF pg_get_functiondef(
       'public.create_broadcast_with_recipients(uuid,uuid,text,text,text,integer,uuid[],jsonb)'::regprocedure
     ) NOT LIKE '%RETURNING id, broadcast_recipients.contact_id%' THEN
    RAISE EXCEPTION
      'create_broadcast_with_recipients still has the ambiguous RETURNING — migration 041 did not apply';
  END IF;

  IF to_regprocedure(
       'public.create_broadcast_with_recipients(uuid,uuid,text,text,text,integer,uuid[],jsonb[])'
     ) IS NOT NULL THEN
    RAISE EXCEPTION
      'the JSONB[] overload of create_broadcast_with_recipients still exists — migration 049 did not apply';
  END IF;

  -- The failure-reason columns (042) are only ever written by the
  -- status webhook, which uses an untyped update — a missing column
  -- there is a runtime PostgREST error on every failed send, not a
  -- compile error.
  IF (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages'
      AND column_name IN ('error_code', 'error_title', 'error_details')
  ) <> 3 THEN
    RAISE EXCEPTION
      'messages.error_code/error_title/error_details are missing — migration 042 did not apply';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND cmd IN ('SELECT', 'ALL')
      AND (roles && ARRAY['public', 'anon']::name[])
      AND (qual LIKE '%avatars%' OR qual LIKE '%flow-media%' OR qual LIKE '%chat-media%')
  ) THEN
    RAISE EXCEPTION
      'a storage SELECT policy on avatars/flow-media/chat-media still applies to anon — migration 043 did not apply';
  END IF;
  IF (
    SELECT COUNT(*) FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::name[]
      AND policyname IN (
        'Users can read their own avatar',
        'Members can read flow media',
        'Members can read chat media'
      )
  ) <> 3 THEN
    RAISE EXCEPTION
      'the scoped storage SELECT policies are missing — migration 043 did not apply';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'public._bcast_bump(uuid,text,integer)',
      'public.recompute_broadcast_counts(uuid)',
      'public.claim_ai_reply_slot(uuid,integer)',
      'public.record_webhook_failure(uuid,integer)',
      'public.merge_duplicate_contacts()',
      'public.merge_duplicate_conversations()'
    ]::regprocedure[]) AS f(fn)
    WHERE has_function_privilege('anon', f.fn, 'EXECUTE')
       OR has_function_privilege('authenticated', f.fn, 'EXECUTE')
       OR NOT has_function_privilege('service_role', f.fn, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION
      'an internal SECURITY DEFINER function is still executable by anon/authenticated — migration 044 did not apply';
  END IF;

  -- 045 widens the automation_pending_executions status CHECK. It is a
  -- DROP + ADD by name, so a wrong constraint name would leave the old
  -- CHECK in place and every "wait for reply" park would be rejected at
  -- runtime, not at migration time.
  IF pg_get_constraintdef(
       (SELECT oid FROM pg_constraint
        WHERE conname = 'automation_pending_executions_status_check')
     ) NOT LIKE '%awaiting_reply%' THEN
    RAISE EXCEPTION
      'automation_pending_executions_status_check does not allow awaiting_reply — migration 045 did not apply';
  END IF;
  IF to_regclass('public.idx_automation_pending_awaiting_reply') IS NULL THEN
    RAISE EXCEPTION
      'idx_automation_pending_awaiting_reply is missing — migration 045 did not apply';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_default LIKE '%uuid_generate_v%'
  ) THEN
    RAISE EXCEPTION
      'a public column default still calls uuid-ossp; use gen_random_uuid() so a fresh hosted db push does not hit 42883';
  END IF;

  IF to_regprocedure('public.dashboard_overview(integer,text)') IS NULL THEN
    RAISE EXCEPTION 'public.dashboard_overview(integer, text) is missing — migration 059 did not apply';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'messages_track_conversation_times') THEN
    RAISE EXCEPTION 'messages_track_conversation_times trigger is missing — migration 059 did not apply';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'conversations_stamp_closed_at')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'deals_stamp_closed_at') THEN
    RAISE EXCEPTION 'closed_at triggers are missing — migration 059 did not apply';
  END IF;
  IF has_function_privilege('anon', 'public.dashboard_overview(integer,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute dashboard_overview — migration 059 grants are wrong';
  END IF;

  IF to_regclass('public.conversion_feedback_events') IS NULL
    OR to_regprocedure('public.ads_performance_rollup(uuid,date,date,text,text,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'conversion feedback or ads reporting did not apply';
  END IF;
  IF has_function_privilege('anon', 'public.ads_performance_rollup(uuid,date,date,text,text,text,text,uuid)', 'EXECUTE')
    OR has_column_privilege('authenticated', 'public.conversion_feedback_events', 'identifiers', 'SELECT') THEN
    RAISE EXCEPTION 'conversion feedback or ads reporting grants are too broad';
  END IF;

  IF has_table_privilege('authenticated', 'public.platform_user_provisioning_log', 'SELECT') THEN
    RAISE EXCEPTION 'The platform provisioning audit log is readable by ordinary users';
  END IF;

  BEGIN
    -- Auth inserts the user before applying custom app metadata.
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (v_customer, 'phase1-check@example.test', '{"full_name":"Phase 1 check"}');
    UPDATE auth.users
    SET raw_app_meta_data = jsonb_build_object('wacrm_provisioned_by', v_actor)
    WHERE id = v_customer;

    IF NOT EXISTS (
      SELECT 1
      FROM public.platform_user_provisioning_log log
      JOIN public.accounts a ON a.id = log.account_id
      WHERE log.user_id = v_customer AND log.actor_user_id = v_actor AND a.owner_user_id = v_customer
    ) THEN
      RAISE EXCEPTION 'Platform provisioning did not record the actor and owned workspace';
    END IF;

    SELECT account_id INTO v_workspace
    FROM public.platform_user_provisioning_log WHERE user_id = v_customer;
    IF public.platform_rename_workspace(v_workspace, 'Phase 1 check', 'Renamed workspace', v_actor)
      IS DISTINCT FROM 'updated' THEN
      RAISE EXCEPTION 'Platform workspace rename did not succeed';
    END IF;
    IF public.platform_rename_workspace(v_workspace, 'Phase 1 check', 'Stale edit', v_actor)
      IS DISTINCT FROM 'conflict' THEN
      RAISE EXCEPTION 'Platform workspace rename accepted a stale edit';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.platform_workspace_rename_log
      WHERE account_id = v_workspace AND actor_user_id = v_actor AND new_name = 'Renamed workspace'
    ) OR public.platform_admin_snapshot('phase1-check@example.test', 0) #>> '{workspaces,0,name}'
      IS DISTINCT FROM 'Renamed workspace' THEN
      RAISE EXCEPTION 'Platform audit or searchable workspace directory did not reflect the saved rename';
    END IF;

    INSERT INTO public.platform_plans (name, monthly_price_paise, yearly_price_paise, max_contacts, max_team, features)
    VALUES ('Phase 3 check', 10000, 100000, 0, 1, ARRAY['campaigns'])
    RETURNING id INTO v_plan;
    IF public.platform_assign_workspace_plan(v_workspace, v_plan, v_actor, 1, NULL, NULL, NULL)
      IS DISTINCT FROM 'saved' THEN
      RAISE EXCEPTION 'Platform plan assignment did not succeed';
    END IF;
    IF public.workspace_feature_allowed(v_workspace, 'api')
      OR NOT public.workspace_feature_allowed(v_workspace, 'campaigns') THEN
      RAISE EXCEPTION 'Workspace plan features were not applied';
    END IF;

    INSERT INTO public.contacts (user_id, account_id, phone) VALUES (v_customer, v_workspace, '15550000031');
    BEGIN
      INSERT INTO public.contacts (user_id, account_id, phone) VALUES (v_customer, v_workspace, '15550000032');
      RAISE EXCEPTION 'Workspace contact limit was not enforced';
    EXCEPTION WHEN check_violation THEN
      IF SQLERRM NOT LIKE 'Workspace plan limit%' THEN RAISE; END IF;
    END;

    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (v_staff, 'phase3-staff@example.test', '{"full_name":"Phase 3 staff"}');
    UPDATE auth.users SET raw_app_meta_data = jsonb_build_object(
      'wacrm_staff_assignment', jsonb_build_object('account_id', v_workspace, 'role', 'agent', 'actor_id', v_customer)
    ) WHERE id = v_staff;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_staff AND account_id = v_workspace AND account_role = 'agent')
      OR NOT EXISTS (SELECT 1 FROM public.workspace_staff_provisioning_log WHERE user_id = v_staff AND actor_user_id = v_customer)
      OR EXISTS (SELECT 1 FROM public.accounts WHERE owner_user_id = v_staff) THEN
      RAISE EXCEPTION 'Staff provisioning did not create the audited workspace membership';
    END IF;

    v_today := private.commercial_today();
    IF public.platform_save_commercial(v_workspace, v_actor, 'subscription_saved',
      jsonb_build_object('access_type','trial','starts_on',v_today-7,'ends_on',v_today-1,
        'suspended',false,'expected_updated_at',NULL)) IS DISTINCT FROM 'saved' THEN
      RAISE EXCEPTION 'Could not save workspace access';
    END IF;
    PERFORM set_config('request.jwt.claim.sub', v_staff::text, true);
    IF public.current_workspace_access() IS DISTINCT FROM 'expired'
      OR public.is_account_member(v_workspace, 'viewer')
      OR public.workspace_feature_allowed(v_workspace, 'campaigns') THEN
      RAISE EXCEPTION 'An expired workspace retained CRM access';
    END IF;
    PERFORM set_config('request.jwt.claim.sub', '', true);
    v_payment_payload := jsonb_build_object('id',v_payment,'amount_paise',12500,'received_on',v_today,'reference','ci-payment');
    IF public.platform_save_commercial(v_workspace,v_actor,'payment_recorded',v_payment_payload) IS DISTINCT FROM 'saved'
      OR public.platform_save_commercial(v_workspace,v_actor,'payment_recorded',v_payment_payload) IS DISTINCT FROM 'saved' THEN
      RAISE EXCEPTION 'Payment could not be recorded or retried';
    END IF;
    IF (SELECT count(*) FROM public.workspace_payments WHERE account_id = v_workspace) <> 1 THEN
      RAISE EXCEPTION 'Payment retries produced inconsistent ledger entries';
    END IF;
    IF public.platform_save_commercial(v_workspace,v_actor,'payment_voided',jsonb_build_object('id',v_payment)) IS DISTINCT FROM 'saved' THEN
      RAISE EXCEPTION 'Payment could not be voided';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.workspace_payments WHERE id=v_payment AND voided_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Voiding a payment failed to preserve the ledger entry';
    END IF;

    RAISE SQLSTATE 'P1010';
  EXCEPTION WHEN SQLSTATE 'P1010' THEN
    NULL;
  END;

  IF has_table_privilege('authenticated', 'public.platform_workspace_rename_log', 'SELECT')
    OR has_function_privilege('authenticated', 'public.platform_rename_workspace(uuid,text,text,uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.platform_admin_snapshot(text,integer)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.platform_admin_snapshot(text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Platform workspace management grants are too broad';
  END IF;
  IF has_table_privilege('authenticated', 'public.platform_plans', 'SELECT')
    OR has_function_privilege('authenticated', 'public.platform_assign_workspace_plan(uuid,uuid,uuid,integer,integer,integer,text[])', 'EXECUTE')
    OR has_function_privilege('anon', 'public.workspace_feature_allowed(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Workspace plan management grants are too broad';
  END IF;
  IF has_table_privilege('authenticated', 'public.workspace_payments', 'SELECT')
    OR has_function_privilege('authenticated', 'public.platform_save_commercial(uuid,uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Workspace billing grants are too broad';
  END IF;

  IF (
    SELECT count(*) FROM pg_constraint
    WHERE convalidated AND contype = 'f' AND connamespace = 'public'::regnamespace
      AND cardinality(conkey) = 2
      AND conname IN ('conversations_contact_id_fkey', 'deals_contact_id_fkey',
        'deals_conversation_id_fkey', 'deals_pipeline_id_fkey',
        'deals_stage_id_fkey', 'messages_reply_to_message_id_fkey')
  ) <> 6 THEN
    RAISE EXCEPTION 'Workspace or conversation relationship constraints were not validated';
  END IF;

  RAISE NOTICE 'schema verification passed';
END
$$;

-- Two things this file has already been burned by, both verified in CI
-- rather than assumed:
--
-- 1. It must contain EXACTLY ONE statement. `supabase db query --file`
--    sends the whole file as a prepared statement, and a second
--    top-level statement fails with the distinctly unhelpful "cannot
--    insert multiple commands into a prepared statement" (commit
--    f91a6c8). Add assertions INSIDE the DO block above; do not append
--    a second one.
--
-- 2. A RAISE in here really does fail the job. A deliberately false
--    assertion (commit 42c7db0, run 31579334056) surfaced as
--    `failed to execute query: error: ...` and exited 1. This is not a
--    decorative green tick.
