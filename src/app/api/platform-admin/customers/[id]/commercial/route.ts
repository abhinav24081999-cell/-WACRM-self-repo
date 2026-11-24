import { isUuid } from '@/lib/api/v1/pagination';
import { getPlatformAdmin, isSharedPreview } from '@/lib/auth/platform-admin';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { getT } from '@/lib/i18n/translate';
import {
  ACCESS_TYPES,
  isCommercialDate,
  type AccessType,
} from '@/lib/platform/commercial';

const t = getT('PlatformCommercial');

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getPlatformAdmin();
  if (!actor || isSharedPreview())
    return Response.json(
      { error: getT('PlatformAccess')('accessDenied') },
      { status: 403 }
    );
  const { id } = await params;
  const json =
    request.headers.get('content-type')?.split(';')[0].trim() ===
    'application/json';
  const body = json ? await request.json().catch(() => null) : null;
  if (!isUuid(id) || !body || typeof body !== 'object') {
    return Response.json({ error: t('invalid') }, { status: 400 });
  }
  const action = body.action;
  let payload;
  if (action === 'subscription_saved') {
    const {
      access_type,
      billing_cycle,
      starts_on,
      ends_on,
      suspended,
      expected_updated_at,
    } = body;
    const term = access_type === 'trial' || access_type === 'paid';
    if (
      !ACCESS_TYPES.includes(access_type as AccessType) ||
      !isCommercialDate(starts_on) ||
      (term
        ? !isCommercialDate(ends_on) || ends_on < starts_on
        : ends_on !== null) ||
      (access_type === 'paid'
        ? !['monthly', 'yearly'].includes(billing_cycle)
        : billing_cycle !== null) ||
      typeof suspended !== 'boolean' ||
      (expected_updated_at !== null &&
        (typeof expected_updated_at !== 'string' ||
          expected_updated_at.length > 50 ||
          !Number.isFinite(Date.parse(expected_updated_at))))
    ) {
      return Response.json({ error: t('invalid') }, { status: 400 });
    }
    payload = {
      access_type,
      billing_cycle,
      starts_on,
      ends_on,
      suspended,
      expected_updated_at,
    };
  } else if (action === 'payment_recorded') {
    const { id: paymentId, amount_paise, received_on, reference } = body;
    if (
      typeof paymentId !== 'string' ||
      !isUuid(paymentId) ||
      !Number.isInteger(amount_paise) ||
      amount_paise < 1 ||
      amount_paise > 2_147_483_647 ||
      !isCommercialDate(received_on) ||
      typeof reference !== 'string' ||
      reference.length > 120
    ) {
      return Response.json({ error: t('invalid') }, { status: 400 });
    }
    payload = { id: paymentId, amount_paise, received_on, reference };
  } else if (
    action === 'payment_voided' &&
    typeof body.id === 'string' &&
    isUuid(body.id)
  ) {
    payload = { id: body.id };
  } else {
    return Response.json({ error: t('invalid') }, { status: 400 });
  }

  try {
    const { data, error } = await supabaseAdmin().rpc(
      'platform_save_commercial',
      {
        p_account_id: id,
        p_actor_id: actor.id,
        p_action: action,
        p_payload: payload,
      }
    );
    if (error?.code === '23505')
      return Response.json({ error: t('duplicateReference') }, { status: 409 });
    if (error) throw error;
    if (data === 'saved') return Response.json({ saved: true });
    if (data === 'workspace_missing')
      return Response.json({ error: t('missing') }, { status: 404 });
    if (data === 'platform_owner')
      return Response.json({ error: t('ownerProtected') }, { status: 409 });
    if (data === 'conflict' || data === 'payment_unavailable')
      return Response.json({ error: t('conflict') }, { status: 409 });
    return Response.json(
      { error: t(data === 'invalid_date' ? 'futurePayment' : 'invalid') },
      { status: 400 }
    );
  } catch {
    return Response.json({ error: t('saveFailed') }, { status: 500 });
  }
}
