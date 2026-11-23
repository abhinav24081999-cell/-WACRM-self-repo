CREATE TABLE public.platform_workspace_rename_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  old_name text NOT NULL,
  new_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_workspace_rename_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_workspace_rename_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.platform_workspace_rename_log TO service_role;

CREATE INDEX platform_workspace_rename_log_created_at ON public.platform_workspace_rename_log (created_at DESC);
CREATE INDEX platform_user_provisioning_log_created_at ON public.platform_user_provisioning_log (created_at DESC);

CREATE FUNCTION public.platform_rename_workspace(
  p_account_id uuid, p_expected_name text, p_new_name text, p_actor_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_name text;
BEGIN
  IF p_new_name IS NULL OR char_length(btrim(p_new_name)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid workspace name' USING ERRCODE = '22023';
  END IF;

  SELECT name INTO v_name FROM public.accounts WHERE id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'missing';
  END IF;
  IF v_name = btrim(p_new_name) THEN
    RETURN 'unchanged';
  END IF;
  IF v_name IS DISTINCT FROM p_expected_name THEN
    RETURN 'conflict';
  END IF;

  UPDATE public.accounts SET name = btrim(p_new_name) WHERE id = p_account_id;
  INSERT INTO public.platform_workspace_rename_log (account_id, actor_user_id, old_name, new_name)
  VALUES (p_account_id, p_actor_user_id, v_name, btrim(p_new_name));

  RETURN 'updated';
END;
$$;

CREATE FUNCTION public.platform_admin_snapshot(p_search text, p_offset integer)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH matched_workspaces AS MATERIALIZED (
    SELECT a.id, a.name, a.created_at, owner.email AS owner_email
    FROM public.accounts a
    LEFT JOIN public.profiles owner ON owner.user_id = a.owner_user_id
    WHERE COALESCE(p_search, '') = ''
      OR strpos(lower(a.name), lower(p_search)) > 0
      OR strpos(lower(owner.email), lower(p_search)) > 0
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT 26 OFFSET greatest(p_offset, 0)
  ),
  workspace_page AS (
    SELECT w.*,
      (SELECT count(*) FROM public.profiles p WHERE p.account_id = w.id) AS members,
      (SELECT count(*) FROM public.contacts c WHERE c.account_id = w.id) AS contacts,
      (SELECT count(*) FROM public.whatsapp_config wc WHERE wc.account_id = w.id AND wc.status = 'connected') AS whatsapp
    FROM matched_workspaces w
    ORDER BY w.created_at DESC, w.id DESC
    LIMIT 25
  ),
  recent_activity AS (
    (
      SELECT log.user_id AS id, log.created_at, log.actor_user_id, 'created' AS kind,
        account.name AS workspace_name, NULL::text AS old_name
      FROM public.platform_user_provisioning_log log
      LEFT JOIN public.accounts account ON account.id = log.account_id
      ORDER BY log.created_at DESC, log.user_id DESC
      LIMIT 8
    )
    UNION ALL
    (
      SELECT log.id, log.created_at, log.actor_user_id, 'renamed', log.new_name, log.old_name
      FROM public.platform_workspace_rename_log log
      ORDER BY log.created_at DESC, log.id DESC
      LIMIT 8
    )
    ORDER BY created_at DESC, id DESC
    LIMIT 8
  )
  SELECT jsonb_build_object(
    'totals', jsonb_build_object(
      'workspaces', (SELECT count(*) FROM public.accounts),
      'team', (SELECT count(*) FROM public.profiles WHERE account_role IN ('admin', 'agent')),
      'contacts', (SELECT count(*) FROM public.contacts),
      'whatsapp', (SELECT count(*) FROM public.whatsapp_config WHERE status = 'connected')
    ),
    'has_more', (SELECT count(*) > 25 FROM matched_workspaces),
    'workspaces', COALESCE((
      SELECT jsonb_agg(to_jsonb(w) ORDER BY w.created_at DESC, w.id DESC) FROM workspace_page w
    ), '[]'::jsonb),
    'activity', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', event.id, 'created_at', event.created_at, 'kind', event.kind,
        'workspace_name', event.workspace_name, 'old_name', event.old_name,
        'actor', COALESCE(NULLIF(actor.full_name, ''), actor.email)
      ) ORDER BY event.created_at DESC, event.id DESC)
      FROM recent_activity event
      LEFT JOIN public.profiles actor ON actor.user_id = event.actor_user_id
    ), '[]'::jsonb)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.platform_rename_workspace(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_rename_workspace(uuid, text, text, uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.platform_admin_snapshot(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_snapshot(text, integer) TO service_role;
