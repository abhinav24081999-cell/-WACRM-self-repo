import { getPlatformAdmin, isSharedPreview } from '@/lib/auth/platform-admin';
import { isUuid } from '@/lib/api/v1/pagination';
import { choices, planLimits, PLAN_FEATURES } from '@/lib/auth/workspace-plan';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { getT } from '@/lib/i18n/translate';

const access = getT('PlatformAccess');
const t = getT('WorkspacePlans');

export async function POST(request: Request) {
  if (!(await getPlatformAdmin()) || isSharedPreview()) {
    return Response.json({ error: access('accessDenied') }, { status: 403 });
  }
  if (
    request.headers.get('content-type')?.split(';')[0].trim() !==
    'application/json'
  ) {
    return Response.json({ error: t('invalidPlan') }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  const id = body?.id;
  if (id !== null && (typeof id !== 'string' || !isUuid(id))) {
    return Response.json({ error: t('invalidPlan') }, { status: 400 });
  }
  try {
    const plans = supabaseAdmin().from('platform_plans');
    if (
      id &&
      (body.action === 'archive' ||
        body.action === 'restore' ||
        body.action === 'delete')
    ) {
      const result =
        body.action === 'delete'
          ? await plans
              .delete()
              .eq('id', id)
              .not('archived_at', 'is', null)
              .select('id')
              .maybeSingle()
          : await plans
              .update({
                archived_at:
                  body.action === 'archive' ? new Date().toISOString() : null,
              })
              .eq('id', id)
              .select('id')
              .maybeSingle();
      if (result.error?.code === '23503')
        return Response.json({ error: t('planInUse') }, { status: 409 });
      if (result.error?.code === '23505')
        return Response.json({ error: t('duplicateName') }, { status: 409 });
      if (result.error) throw result.error;
      if (!result.data)
        return Response.json({ error: t('planUnavailable') }, { status: 404 });
      return Response.json({ id });
    }

    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const limits = planLimits(body);
    const features = choices(body.features, PLAN_FEATURES);
    const prices = [body.monthly_price_paise, body.yearly_price_paise];
    if (
      body.action !== 'save' ||
      !name ||
      name.length > 80 ||
      !limits ||
      !features ||
      prices.some((p) => !Number.isInteger(p) || p < 0 || p > 2_147_483_647)
    ) {
      return Response.json({ error: t('invalidPlan') }, { status: 400 });
    }
    const values = {
      ...limits,
      name,
      features,
      monthly_price_paise: prices[0],
      yearly_price_paise: prices[1],
    };
    const result = id
      ? await plans.update(values).eq('id', id).select('id').maybeSingle()
      : await plans.insert(values).select('id').single();
    if (result.error?.code === '23505')
      return Response.json({ error: t('duplicateName') }, { status: 409 });
    if (result.error) throw result.error;
    if (!result.data)
      return Response.json({ error: t('planUnavailable') }, { status: 404 });
    return Response.json(result.data, { status: id ? 200 : 201 });
  } catch {
    return Response.json({ error: t('saveFailed') }, { status: 500 });
  }
}
