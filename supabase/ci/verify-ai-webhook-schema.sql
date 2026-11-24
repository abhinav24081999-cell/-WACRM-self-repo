-- Read-only release check. Run as the database owner before releasing the app.
DO $$
BEGIN
  PERFORM agent_name, agent_purpose, agent_language, qualification_criteria,
    apply_qualified_status, qualified_tag_id
  FROM public.ai_configs WHERE false;

  PERFORM name, payload_fields FROM public.webhook_endpoints WHERE false;
  PERFORM event, response_status, result, created_at
  FROM public.webhook_deliveries WHERE false;

  IF to_regprocedure('public.record_ai_contact_assessment(uuid,uuid,text,text,text,boolean)') IS NULL
    OR to_regprocedure('public.log_webhook_delivery(uuid,uuid,text,integer,text)') IS NULL THEN
    RAISE EXCEPTION 'Missing AI assessment or webhook delivery function';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ai_configs'::regclass
      AND conname = 'ai_configs_provider_check'
      AND position('n8n' in pg_get_constraintdef(oid)) > 0
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ai_usage_log'::regclass
      AND conname = 'ai_usage_log_provider_check'
      AND position('n8n' in pg_get_constraintdef(oid)) > 0
  ) THEN
    RAISE EXCEPTION 'Missing n8n provider support in AI settings or usage';
  END IF;
END
$$;
