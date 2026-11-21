CREATE INDEX leads_ads_performance_dates ON public.leads (account_id, created_at);

CREATE FUNCTION public.ads_performance_rollup(
  p_account_id uuid, p_from date, p_to date, p_platform text, p_level text,
  p_source text DEFAULT NULL, p_status text DEFAULT NULL, p_tag uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'Workspace admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_to < p_from OR p_to - p_from > 90 OR p_level NOT IN ('campaign','ad_group','ad')
    OR p_platform NOT IN ('meta','google','all') THEN
    RAISE EXCEPTION 'Invalid report filters' USING ERRCODE = '22023';
  END IF;

  WITH cohort AS (
    SELECT lead.id, lead.status, lead.ads_platform, lead.attribution,
      CASE p_level WHEN 'campaign' THEN lead.attribution ->> 'campaign_id'
        WHEN 'ad_group' THEN lead.attribution ->> 'ad_group_id' ELSE lead.attribution ->> 'ad_id' END AS entity_id,
      CASE p_level WHEN 'campaign' THEN lead.attribution ->> 'campaign_name'
        WHEN 'ad_group' THEN lead.attribution ->> 'ad_group_name' ELSE lead.attribution ->> 'ad_name' END AS entity_name
    FROM public.leads AS lead
    WHERE lead.account_id = p_account_id AND lead.created_at >= p_from::timestamp AT TIME ZONE 'Asia/Kolkata'
      AND lead.created_at < (p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'
      AND (p_platform = 'all' OR lead.ads_platform = p_platform)
      AND (p_source IS NULL OR lead.source = p_source)
      AND (p_status IS NULL OR lead.status::text = p_status)
      AND (p_tag IS NULL OR EXISTS (
        SELECT 1 FROM public.contact_tags AS assigned JOIN public.tags AS tag ON tag.id = assigned.tag_id
        WHERE assigned.contact_id = lead.contact_id AND tag.account_id = p_account_id AND tag.id = p_tag
      ))
  ), grouped AS (
    SELECT coalesce(ads_platform, 'unattributed') AS platform, nullif(entity_id, '') AS entity_id,
      max(nullif(entity_name, '')) AS name,
      CASE WHEN p_level <> 'campaign' AND nullif(entity_id, '') IS NOT NULL THEN max(attribution ->> 'campaign_id') END AS campaign_id,
      CASE WHEN p_level = 'ad' AND nullif(entity_id, '') IS NOT NULL THEN max(attribution ->> 'ad_group_id') END AS ad_group_id,
      count(*) AS leads,
      count(*) FILTER (WHERE status IN ('qualified','converted') OR (status = 'completed' AND EXISTS (
        SELECT 1 FROM public.lead_status_history AS stage WHERE stage.lead_id = cohort.id AND stage.status IN ('qualified','converted')
      ))) AS qualified,
      count(*) FILTER (WHERE status = 'junk') AS junk,
      count(*) FILTER (WHERE status = 'converted' OR (status = 'completed' AND EXISTS (
        SELECT 1 FROM public.lead_status_history AS stage WHERE stage.lead_id = cohort.id AND stage.status = 'converted'
      ))) AS converted
    FROM cohort GROUP BY ads_platform, nullif(entity_id, '')
  )
  SELECT jsonb_build_object(
    'rows', coalesce((SELECT jsonb_agg(to_jsonb(grouped) ORDER BY leads DESC, platform, entity_id) FROM grouped), '[]'::jsonb),
    'tags', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name)
      FROM public.tags WHERE account_id = p_account_id), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.ads_performance_rollup(uuid,date,date,text,text,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ads_performance_rollup(uuid,date,date,text,text,text,text,uuid) TO authenticated;
