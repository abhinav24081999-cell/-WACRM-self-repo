ALTER TABLE public.messages ADD COLUMN ai_reply_started_at timestamptz;

CREATE FUNCTION public.begin_inbound_ai_reply(
  p_account_id uuid,
  p_conversation_id uuid,
  p_message_id text,
  p_max_replies integer
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_latest_message uuid;
  v_started_at timestamptz := clock_timestamp();
BEGIN
  PERFORM 1 FROM public.conversations
  WHERE id = p_conversation_id AND account_id = p_account_id
    AND NOT ai_autoreply_disabled AND assigned_agent_id IS NULL
    AND ai_reply_count < p_max_replies
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT id INTO v_latest_message FROM public.messages
  WHERE conversation_id = p_conversation_id AND sender_type = 'customer'
  ORDER BY created_at DESC, id DESC LIMIT 1;

  -- Both webhook functions have a 60-second execution limit. A later
  -- delivery can recover an abandoned attempt after the lease expires.
  UPDATE public.messages SET ai_reply_started_at = v_started_at
  WHERE id = v_latest_message AND message_id = p_message_id
    AND ai_reply_claimed_at IS NULL
    AND (ai_reply_started_at IS NULL OR ai_reply_started_at <= v_started_at - interval '2 minutes');
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_inbound_ai_reply(uuid, uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_inbound_ai_reply(uuid, uuid, text, integer)
  TO service_role;
