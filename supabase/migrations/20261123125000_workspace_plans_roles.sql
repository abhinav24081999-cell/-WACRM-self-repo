CREATE TABLE public.platform_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  monthly_price_paise integer NOT NULL CHECK (monthly_price_paise >= 0),
  yearly_price_paise integer NOT NULL CHECK (yearly_price_paise >= 0),
  max_contacts integer CHECK (max_contacts >= 0),
  max_team integer CHECK (max_team >= 0),
  max_whatsapp integer CHECK (max_whatsapp >= 0),
  features text[] NOT NULL CHECK (features <@ ARRAY['ai','automation','campaigns','api','webhooks','capi']),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX platform_plans_active_name
  ON public.platform_plans (lower(name)) WHERE archived_at IS NULL;

CREATE TABLE public.workspace_plan_settings (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.platform_plans(id),
  max_contacts integer CHECK (max_contacts >= 0),
  max_team integer CHECK (max_team >= 0),
  max_whatsapp integer CHECK (max_whatsapp >= 0),
  features text[] CHECK (features <@ ARRAY['ai','automation','campaigns','api','webhooks','capi'])
);
CREATE INDEX workspace_plan_settings_plan_idx ON public.workspace_plan_settings(plan_id);

CREATE TABLE public.workspace_role_permissions (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  role public.account_role_enum NOT NULL CHECK (role IN ('admin', 'agent')),
  denied text[] NOT NULL CHECK (denied <@ ARRAY['contacts', 'inbox', 'campaigns', 'automation']),
  PRIMARY KEY (account_id, role)
);

ALTER TABLE public.platform_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_plan_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_role_permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_plans, public.workspace_plan_settings, public.workspace_role_permissions
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_plans, public.workspace_plan_settings TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.workspace_role_permissions TO authenticated;
CREATE POLICY workspace_owner_role_permissions ON public.workspace_role_permissions
  FOR ALL TO authenticated
  USING (public.is_account_member(account_id, 'owner'))
  WITH CHECK (public.is_account_member(account_id, 'owner'));

CREATE FUNCTION public.workspace_action_allowed(p_account_id uuid, p_action text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT auth.uid() IS NULL OR EXISTS (
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.workspace_role_permissions r
      ON r.account_id = p.account_id AND r.role = p.account_role
    WHERE p.user_id = auth.uid() AND p.account_id = p_account_id
      AND p.account_role IN ('owner', 'admin', 'agent')
      AND NOT COALESCE(p_action = ANY(r.denied), false)
  );
$$;

CREATE FUNCTION public.workspace_feature_allowed(p_account_id uuid, p_feature text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT (auth.uid() IS NULL OR public.is_account_member(p_account_id))
    AND COALESCE((
      SELECT p_feature = ANY(COALESCE(s.features, p.features))
      FROM public.workspace_plan_settings s
      JOIN public.platform_plans p ON p.id = s.plan_id
      WHERE s.account_id = p_account_id
    ), true);
$$;

REVOKE EXECUTE ON FUNCTION public.workspace_action_allowed(uuid, text),
  public.workspace_feature_allowed(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_action_allowed(uuid, text),
  public.workspace_feature_allowed(uuid, text) TO authenticated, service_role;

CREATE FUNCTION private.enforce_workspace_quota()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_limit integer;
  v_count bigint;
BEGIN
  IF TG_TABLE_NAME = 'profiles' THEN
    IF NEW.account_role NOT IN ('admin', 'agent') OR
      (TG_OP = 'UPDATE' AND OLD.account_id = NEW.account_id AND OLD.account_role IN ('admin', 'agent')) THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.account_id = NEW.account_id THEN
    RETURN NEW;
  END IF;

  -- Serialize growth for an account. AFTER INSERT ignores upserts which found an existing row.
  PERFORM 1 FROM public.accounts a JOIN public.workspace_plan_settings s ON s.account_id = a.id
  WHERE a.id = NEW.account_id FOR NO KEY UPDATE OF a;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT CASE TG_TABLE_NAME
    WHEN 'contacts' THEN COALESCE(s.max_contacts, p.max_contacts)
    WHEN 'profiles' THEN COALESCE(s.max_team, p.max_team)
    WHEN 'whatsapp_config' THEN COALESCE(s.max_whatsapp, p.max_whatsapp)
  END INTO v_limit
  FROM public.workspace_plan_settings s JOIN public.platform_plans p ON p.id = s.plan_id
  WHERE s.account_id = NEW.account_id;
  IF v_limit IS NULL THEN RETURN NEW; END IF;

  CASE TG_TABLE_NAME
    WHEN 'contacts' THEN SELECT count(*) INTO v_count FROM public.contacts WHERE account_id = NEW.account_id;
    WHEN 'profiles' THEN SELECT count(*) INTO v_count FROM public.profiles
      WHERE account_id = NEW.account_id AND account_role IN ('admin', 'agent');
    WHEN 'whatsapp_config' THEN SELECT count(*) INTO v_count FROM public.whatsapp_config WHERE account_id = NEW.account_id;
  END CASE;
  IF v_count > v_limit THEN
    RAISE EXCEPTION 'Workspace plan limit reached for %', TG_ARGV[0] USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.enforce_workspace_quota() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER workspace_contact_quota AFTER INSERT OR UPDATE OF account_id ON public.contacts
FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_quota('contacts');
CREATE TRIGGER workspace_team_quota AFTER INSERT OR UPDATE OF account_id, account_role ON public.profiles
FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_quota('admin and agent seats');
CREATE TRIGGER workspace_whatsapp_quota AFTER INSERT OR UPDATE OF account_id ON public.whatsapp_config
FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_quota('WhatsApp numbers');

CREATE FUNCTION private.enforce_workspace_action()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  CASE TG_TABLE_NAME
    WHEN 'contact_tags' THEN
      SELECT account_id INTO v_account_id FROM public.contacts
      WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.contact_id ELSE NEW.contact_id END;
    WHEN 'flow_nodes' THEN
      SELECT account_id INTO v_account_id FROM public.flows
      WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.flow_id ELSE NEW.flow_id END;
    WHEN 'automation_steps' THEN
      SELECT account_id INTO v_account_id FROM public.automations
      WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.automation_id ELSE NEW.automation_id END;
    WHEN 'broadcast_recipients' THEN
      SELECT account_id INTO v_account_id FROM public.broadcasts
      WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.broadcast_id ELSE NEW.broadcast_id END;
    ELSE v_account_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.account_id ELSE NEW.account_id END;
  END CASE;
  IF TG_OP = 'DELETE' AND v_account_id IS NULL THEN RETURN OLD; END IF;
  IF TG_ARGV[0] <> '' AND NOT public.workspace_action_allowed(v_account_id, TG_ARGV[0]) THEN
    RAISE EXCEPTION 'Your workspace role cannot perform this action' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_ARGV[1] <> '' AND NOT public.workspace_feature_allowed(v_account_id, TG_ARGV[1]) THEN
    RAISE EXCEPTION 'Your workspace plan does not include this feature' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.enforce_workspace_action() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER workspace_contacts_action BEFORE INSERT OR UPDATE OR DELETE ON public.contacts
FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_action('contacts', '');
CREATE TRIGGER workspace_contact_notes_action BEFORE INSERT OR UPDATE OR DELETE ON public.contact_notes
FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_action('contacts', '');
CREATE TRIGGER workspace_contact_tags_action BEFORE INSERT OR UPDATE OR DELETE ON public.contact_tags
FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_action('contacts', '');
CREATE TRIGGER workspace_inbox_conversation_action BEFORE INSERT OR UPDATE OR DELETE ON public.conversations
FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_action('inbox', '');
CREATE TRIGGER workspace_inbox_message_action BEFORE INSERT OR UPDATE OR DELETE ON public.messages
FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_action('inbox', '');
CREATE TRIGGER workspace_campaign_action BEFORE INSERT OR UPDATE OR DELETE ON public.broadcasts
FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_action('campaigns', 'campaigns');
CREATE TRIGGER workspace_campaign_recipients_action BEFORE INSERT OR UPDATE OR DELETE ON public.broadcast_recipients
FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_action('campaigns', 'campaigns');
CREATE TRIGGER workspace_automation_action BEFORE INSERT OR UPDATE OR DELETE ON public.automations
FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_action('automation', 'automation');
CREATE TRIGGER workspace_automation_steps_action BEFORE INSERT OR UPDATE OR DELETE ON public.automation_steps
FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_action('automation', 'automation');
CREATE TRIGGER workspace_flow_action BEFORE INSERT OR UPDATE OR DELETE ON public.flows
FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_action('automation', 'automation');
CREATE TRIGGER workspace_flow_nodes_action BEFORE INSERT OR UPDATE OR DELETE ON public.flow_nodes
FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_action('automation', 'automation');
CREATE TRIGGER workspace_ai_plan BEFORE INSERT OR UPDATE ON public.ai_configs
FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_action('', 'ai');
CREATE TRIGGER workspace_webhook_plan BEFORE INSERT OR UPDATE ON public.webhook_endpoints
FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_action('', 'webhooks');
CREATE TRIGGER workspace_api_key_plan BEFORE INSERT ON public.api_keys
FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_action('', 'api');
CREATE TRIGGER workspace_feedback_plan BEFORE INSERT OR UPDATE ON public.conversion_feedback_rules
FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_action('', 'capi');

CREATE FUNCTION private.skip_unentitled_conversion()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF public.workspace_feature_allowed(NEW.account_id, 'capi') THEN RETURN NEW; END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.skip_unentitled_conversion() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER workspace_feedback_event_plan BEFORE INSERT ON public.conversion_feedback_events
FOR EACH ROW EXECUTE FUNCTION private.skip_unentitled_conversion();

CREATE FUNCTION public.platform_assign_workspace_plan(
  p_account_id uuid, p_plan_id uuid, p_actor_id uuid,
  p_max_contacts integer, p_max_team integer, p_max_whatsapp integer, p_features text[]
)
RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
  v_archived_at timestamptz;
  v_existing_plan uuid;
BEGIN
  SELECT owner_user_id INTO v_owner FROM public.accounts WHERE id = p_account_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN 'workspace_missing'; END IF;
  IF p_plan_id IS NULL THEN
    DELETE FROM public.workspace_plan_settings WHERE account_id = p_account_id;
    RETURN 'saved';
  END IF;
  IF v_owner = p_actor_id THEN RETURN 'platform_owner'; END IF;
  SELECT archived_at INTO v_archived_at FROM public.platform_plans WHERE id = p_plan_id FOR SHARE;
  IF NOT FOUND THEN RETURN 'plan_unavailable'; END IF;
  SELECT plan_id INTO v_existing_plan FROM public.workspace_plan_settings WHERE account_id = p_account_id;
  IF v_archived_at IS NOT NULL AND v_existing_plan IS DISTINCT FROM p_plan_id THEN
    RETURN 'plan_unavailable';
  END IF;
  INSERT INTO public.workspace_plan_settings (account_id, plan_id, max_contacts, max_team, max_whatsapp, features)
  VALUES (p_account_id, p_plan_id, p_max_contacts, p_max_team, p_max_whatsapp, p_features)
  ON CONFLICT (account_id) DO UPDATE SET
    plan_id = EXCLUDED.plan_id, max_contacts = EXCLUDED.max_contacts, max_team = EXCLUDED.max_team,
    max_whatsapp = EXCLUDED.max_whatsapp, features = EXCLUDED.features;
  RETURN 'saved';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.platform_assign_workspace_plan(uuid, uuid, uuid, integer, integer, integer, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_assign_workspace_plan(uuid, uuid, uuid, integer, integer, integer, text[])
  TO service_role;

CREATE TABLE public.workspace_staff_provisioning_log (
  user_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  role public.account_role_enum NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspace_staff_provisioning_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_staff_provisioning_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.workspace_staff_provisioning_log TO service_role;

CREATE FUNCTION private.provision_workspace_staff()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_assignment jsonb := NEW.raw_app_meta_data->'wacrm_staff_assignment';
  v_account uuid;
  v_actor uuid;
  v_role public.account_role_enum;
  v_home uuid;
BEGIN
  IF v_assignment IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.raw_app_meta_data->'wacrm_staff_assignment' = v_assignment THEN RETURN NEW; END IF;
  v_account := (v_assignment->>'account_id')::uuid;
  v_actor := (v_assignment->>'actor_id')::uuid;
  v_role := (v_assignment->>'role')::public.account_role_enum;

  PERFORM 1 FROM public.accounts WHERE id = v_account FOR NO KEY UPDATE;
  IF NOT FOUND OR v_role IS NULL OR v_role = 'owner' OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE user_id = v_actor AND account_id = v_account
      AND account_role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Invalid staff provisioning assignment' USING ERRCODE = '42501';
  END IF;

  SELECT a.id INTO v_home FROM public.accounts a JOIN public.profiles p ON p.account_id = a.id
  WHERE a.owner_user_id = NEW.id AND p.user_id = NEW.id AND p.account_role = 'owner';
  IF NOT FOUND OR v_home = v_account THEN RAISE EXCEPTION 'New staff profile has no personal workspace'; END IF;

  -- Auth creates the profile and this assignment inside the same transaction.
  UPDATE public.profiles SET account_id = v_account, account_role = v_role WHERE user_id = NEW.id;
  DELETE FROM public.accounts WHERE id = v_home;
  INSERT INTO public.workspace_staff_provisioning_log (user_id, account_id, actor_user_id, role)
    VALUES (NEW.id, v_account, v_actor, v_role);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.provision_workspace_staff() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER on_auth_user_staff_assignment AFTER INSERT OR UPDATE OF raw_app_meta_data ON auth.users
FOR EACH ROW EXECUTE FUNCTION private.provision_workspace_staff();

-- Preserve configured plans and role rules when redeeming an invitation.
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
