ALTER TABLE public.ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_provider_check,
  ADD CONSTRAINT ai_configs_provider_check
    CHECK (provider IN ('openai', 'anthropic', 'gemini', 'n8n', 'openai_compatible'));

ALTER TABLE public.ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check,
  ADD CONSTRAINT ai_usage_log_provider_check
    CHECK (provider IN ('openai', 'anthropic', 'gemini', 'n8n', 'openai_compatible'));

ALTER TABLE public.ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_openai_compatible_base_url_check,
  ADD CONSTRAINT ai_configs_openai_compatible_base_url_check
    CHECK (provider NOT IN ('openai_compatible', 'n8n') OR NULLIF(btrim(base_url), '') IS NOT NULL);
