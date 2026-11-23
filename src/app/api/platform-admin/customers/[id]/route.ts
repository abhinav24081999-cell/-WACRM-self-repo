import { isUuid } from '@/lib/api/v1/pagination';
import { getPlatformAdmin, isSharedPreview } from '@/lib/auth/platform-admin';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { getT } from '@/lib/i18n/translate';
import {
  checkRateLimit,
  RATE_LIMITS,
  rateLimitResponse,
} from '@/lib/rate-limit';

const t = getT('PlatformAccess');
const dashboard = getT('PlatformDashboard');

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getPlatformAdmin();
  if (!actor)
    return Response.json({ error: t('accessDenied') }, { status: 403 });
  if (isSharedPreview()) {
    return Response.json(
      { error: dashboard('previewNotice') },
      { status: 403 }
    );
  }

  const limit = checkRateLimit(
    `platform-rename:${actor.id}`,
    RATE_LIMITS.adminAction
  );
  if (!limit.success) return rateLimitResponse(limit);

  const { id } = await params;
  const contentType = request.headers.get('content-type')?.split(';')[0].trim();
  const body =
    contentType === 'application/json'
      ? await request.json().catch(() => null)
      : null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (
    !isUuid(id) ||
    !name ||
    name.length > 100 ||
    typeof body?.expectedName !== 'string'
  ) {
    return Response.json({ error: dashboard('invalidName') }, { status: 400 });
  }

  try {
    const { data, error } = await supabaseAdmin().rpc(
      'platform_rename_workspace',
      {
        p_account_id: id,
        p_expected_name: body.expectedName,
        p_new_name: name,
        p_actor_user_id: actor.id,
      }
    );
    if (
      error ||
      !['missing', 'conflict', 'updated', 'unchanged'].includes(data)
    ) {
      console.error('[platform-rename] failed:', error?.code);
      return Response.json(
        { error: dashboard('renameFailed') },
        { status: 500 }
      );
    }
    if (data === 'missing')
      return Response.json(
        { error: dashboard('workspaceMissing') },
        { status: 404 }
      );
    if (data === 'conflict')
      return Response.json(
        { error: dashboard('renameConflict') },
        { status: 409 }
      );
    return Response.json({ name });
  } catch {
    return Response.json({ error: dashboard('renameFailed') }, { status: 500 });
  }
}
