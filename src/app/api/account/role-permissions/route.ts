import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isSharedPreview } from '@/lib/auth/platform-admin';
import { choices, ROLE_ACTIONS } from '@/lib/auth/workspace-plan';
import { getT } from '@/lib/i18n/translate';

const t = getT('WorkspacePlans');

export async function GET() {
  try {
    const ctx = await requireRole('owner');
    if (isSharedPreview())
      return Response.json({ admin: [], agent: ['campaigns'], readOnly: true });
    const { data, error } = await ctx.supabase
      .from('workspace_role_permissions')
      .select('role,denied')
      .eq('account_id', ctx.accountId);
    if (error)
      return Response.json({ error: t('loadFailed') }, { status: 503 });
    return Response.json({
      admin: data.find((row) => row.role === 'admin')?.denied ?? [],
      agent: data.find((row) => row.role === 'agent')?.denied ?? [],
      readOnly: false,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('owner');
    if (isSharedPreview())
      return Response.json({ error: t('preview') }, { status: 403 });
    const contentType = request.headers
      .get('content-type')
      ?.split(';')[0]
      .trim();
    const body =
      contentType === 'application/json'
        ? await request.json().catch(() => null)
        : null;
    const admin = choices(body?.admin, ROLE_ACTIONS);
    const agent = choices(body?.agent, ROLE_ACTIONS);
    if (!admin || !agent)
      return Response.json({ error: t('invalidPlan') }, { status: 400 });
    const { error } = await ctx.supabase
      .from('workspace_role_permissions')
      .upsert(
        [
          { account_id: ctx.accountId, role: 'admin', denied: admin },
          { account_id: ctx.accountId, role: 'agent', denied: agent },
        ],
        { onConflict: 'account_id,role' }
      );
    if (error)
      return Response.json({ error: t('saveFailed') }, { status: 503 });
    return Response.json({ saved: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
