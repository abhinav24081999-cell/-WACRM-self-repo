ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS qualification_criteria text CHECK (char_length(qualification_criteria) <= 4000),
  ADD COLUMN IF NOT EXISTS apply_qualified_status boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qualified_tag_id uuid REFERENCES public.tags(id) ON DELETE SET NULL;

ALTER TABLE public.contact_notes
  ADD COLUMN IF NOT EXISTS ai_source_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX contact_notes_ai_source_once
  ON public.contact_notes (ai_source_message_id)
  WHERE ai_source_message_id IS NOT NULL;

CREATE FUNCTION public.record_ai_contact_assessment(
  p_account_id uuid,
  p_conversation_id uuid,
  p_message_external_id text,
  p_outcome text,
  p_evidence text,
  p_follow_up boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  conversation public.conversations%ROWTYPE;
  source_message public.messages%ROWTYPE;
  settings public.ai_configs%ROWTYPE;
  note_id uuid;
  lead_ids uuid[];
  applied_tag text;
  target_lead_id uuid;
  qualified_history_id bigint;
  note text;
BEGIN
  IF p_outcome NOT IN ('qualified', 'not_interested', 'needs_information', 'human_review')
    OR char_length(p_evidence) NOT BETWEEN 4 AND 280 THEN RETURN; END IF;

  SELECT * INTO settings FROM public.ai_configs
  WHERE account_id = p_account_id AND is_active AND auto_reply_enabled
    AND qualification_criteria IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO conversation FROM public.conversations
  WHERE id = p_conversation_id AND account_id = p_account_id
    AND NOT ai_autoreply_disabled AND assigned_agent_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO source_message FROM public.messages
  WHERE conversation_id = p_conversation_id AND sender_type = 'customer'
  ORDER BY created_at DESC, id DESC LIMIT 1;
  IF NOT FOUND OR source_message.message_id IS DISTINCT FROM p_message_external_id THEN RETURN; END IF;

  IF strpos(regexp_replace(coalesce(source_message.content_text, ''), '\s+', ' ', 'g'), p_evidence) = 0 THEN
    RETURN;
  END IF;

  note := 'AI assessment' || E'\n• ' || CASE p_outcome
    WHEN 'qualified' THEN 'Qualified'
    WHEN 'not_interested' THEN 'Not interested'
    WHEN 'needs_information' THEN 'Needs more information'
    ELSE 'Human review requested' END
    || E'\n• Customer said: “' || p_evidence || '”'
    || CASE WHEN p_follow_up THEN E'\n• Suggested next step: Review the customer’s follow-up request.' ELSE '' END;

  IF EXISTS (
    SELECT 1 FROM public.contact_notes
    WHERE account_id = p_account_id AND contact_id = conversation.contact_id AND left(note_text, char_length(note)) = note
      AND ai_source_message_id IS NOT NULL
  ) THEN RETURN; END IF;

  INSERT INTO public.contact_notes(account_id, contact_id, user_id, note_text, ai_source_message_id)
  VALUES (p_account_id, conversation.contact_id, conversation.user_id, note, source_message.id)
  ON CONFLICT (ai_source_message_id) WHERE ai_source_message_id IS NOT NULL DO NOTHING
  RETURNING id INTO note_id;
  IF note_id IS NULL OR p_outcome <> 'qualified' THEN RETURN; END IF;

  IF settings.qualified_tag_id IS NOT NULL THEN
    INSERT INTO public.contact_tags (contact_id, tag_id)
    SELECT conversation.contact_id, id FROM public.tags
    WHERE id = settings.qualified_tag_id AND account_id = p_account_id
    ON CONFLICT (contact_id, tag_id) DO NOTHING
    RETURNING tag_id::text INTO applied_tag;
    IF applied_tag IS NOT NULL THEN
      UPDATE public.contact_notes SET note_text = note_text || E'\n• Applied tag: ' ||
        (SELECT name FROM public.tags WHERE id = settings.qualified_tag_id AND account_id = p_account_id)
      WHERE id = note_id;
    END IF;
  END IF;

  IF NOT settings.apply_qualified_status THEN RETURN; END IF;
  SELECT ARRAY(
    SELECT id FROM public.leads
    WHERE account_id = p_account_id AND contact_id = conversation.contact_id
      AND status NOT IN ('converted', 'completed')
    LIMIT 2
  ) INTO lead_ids;
  IF cardinality(lead_ids) <> 1 THEN RETURN; END IF;

  UPDATE public.leads SET status = 'qualified'
  WHERE id = lead_ids[1] AND account_id = p_account_id AND contact_id = conversation.contact_id
    AND status IN ('new', 'interested', 'busy', 'no_response', 'in_process')
  RETURNING id INTO target_lead_id;

  IF target_lead_id IS NOT NULL THEN
    SELECT id INTO qualified_history_id FROM public.lead_status_history
    WHERE lead_id = target_lead_id AND status = 'qualified'
    ORDER BY id DESC LIMIT 1;
    -- The normal status history trigger has already handed off to the existing CAPI rules.
    UPDATE public.lead_status_history SET changed_by_name = 'AI Agent'
    WHERE id = qualified_history_id AND changed_by IS NULL;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_ai_contact_assessment(uuid, uuid, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_contact_assessment(uuid, uuid, text, text, text, boolean) TO service_role;

ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS agent_name text CHECK (char_length(agent_name) <= 80),
  ADD COLUMN IF NOT EXISTS agent_purpose text CHECK (char_length(agent_purpose) <= 240),
  ADD COLUMN IF NOT EXISTS agent_language text CHECK (agent_language IN ('auto', 'English', 'Hindi', 'Hinglish'));
