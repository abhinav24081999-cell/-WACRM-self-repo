import { getPlatformAdmin, isSharedPreview } from '@/lib/auth/platform-admin';
import { isUuid } from '@/lib/api/v1/pagination';
import { choices, PLAN_FEATURES, planLimits } from '@/lib/auth/workspace-plan';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { getT } from '@/lib/i18n/translate';

const access = getT('PlatformAccess');
const t = getT('WorkspacePlans');

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getPlatformAdmin();
  if (!admin || isSharedPreview())
    return Response.json({ error: access('accessDenied') }, { status: 403 });
  const { id } = await params;
  const contentType = request.headers.get('content-type')?.split(';')[0].trim();
  const body =
    contentType === 'application/json'
      ? await request.json().catch(() => null)
      : null;
  const planId = body?.plan_id;
  const limits = body ? planLimits(body) : null;
  const features =
    body?.features === null ? null : choices(body?.features, PLAN_FEATURES);
  if (
    !isUuid(id) ||
    (planId !== null && (typeof planId !== 'string' || !isUuid(planId))) ||
    !limits ||
    (features === null && body.features !== null)
  ) {
    return Response.json({ error: t('invalidPlan') }, { status: 400 });
  }
  try {
    const { data, error } = await supabaseAdmin().rpc(
      'platform_assign_workspace_plan',
      {
        p_account_id: id,
        p_plan_id: planId,
        p_actor_id: admin.id,
        p_max_contacts: limits.max_contacts,
        p_max_team: limits.max_team,
        p_max_whatsapp: limits.max_whatsapp,
        p_features: features,
      }
    );
    if (error) throw error;
    if (data === 'platform_owner')
      return Response.json({ error: t('platformOwner') }, { status: 409 });
    if (data === 'plan_unavailable')
      return Response.json({ error: t('planUnavailable') }, { status: 409 });
    if (data !== 'saved')
      return Response.json({ error: t('workspaceMissing') }, { status: 404 });
    return Response.json({ saved: true });
  } catch {
    return Response.json({ error: t('saveFailed') }, { status: 500 });
  }
}
