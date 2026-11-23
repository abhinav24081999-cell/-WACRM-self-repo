ALTER TABLE public.webhook_endpoints
  ADD COLUMN IF NOT EXISTS name text CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 80),
  ADD COLUMN IF NOT EXISTS payload_fields text[];

CREATE TABLE public.webhook_deliveries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  endpoint_id uuid NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  event text NOT NULL,
  response_status integer,
  result text NOT NULL CHECK (result IN ('delivered', 'http_error', 'network_error', 'blocked_destination', 'secret_error')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX webhook_deliveries_endpoint_recent_idx
  ON public.webhook_deliveries (endpoint_id, created_at DESC);

ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhook_deliveries FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.webhook_deliveries TO service_role;

CREATE OR REPLACE FUNCTION public.log_webhook_delivery(
  p_endpoint_id uuid,
  p_event_id uuid,
  p_event text,
  p_status integer,
  p_result text
) RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.webhook_endpoints WHERE id = p_endpoint_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  INSERT INTO public.webhook_deliveries(endpoint_id, event_id, event, response_status, result)
  VALUES (p_endpoint_id, p_event_id, p_event, p_status, p_result);

  DELETE FROM public.webhook_deliveries
  WHERE id IN (
    SELECT id FROM public.webhook_deliveries WHERE endpoint_id = p_endpoint_id
    ORDER BY created_at DESC, id DESC OFFSET 100
  );
END;
$$;
REVOKE ALL ON FUNCTION public.log_webhook_delivery(uuid, uuid, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_webhook_delivery(uuid, uuid, text, integer, text) TO service_role;
