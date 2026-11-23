import { randomBytes } from 'node:crypto';
import { getPlatformAdmin, isSharedPreview } from '@/lib/auth/platform-admin';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { getT } from '@/lib/i18n/translate';
import {
  checkRateLimit,
  RATE_LIMITS,
  rateLimitResponse,
} from '@/lib/rate-limit';

const t = getT('PlatformAccess');

export async function POST(request: Request) {
  const actor = await getPlatformAdmin();
  if (!actor)
    return Response.json({ error: t('accessDenied') }, { status: 403 });
  if (isSharedPreview()) {
    return Response.json({ error: t('previewReadOnly') }, { status: 403 });
  }

  const limit = checkRateLimit(
    `platform-provision:${actor.id}`,
    RATE_LIMITS.adminAction
  );
  if (!limit.success) return rateLimitResponse(limit);

  const contentType = request.headers.get('content-type')?.split(';')[0].trim();
  const body =
    contentType === 'application/json'
      ? await request.json().catch(() => null)
      : null;
  const email =
    typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (
    !name ||
    name.length > 100 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return Response.json({ error: t('invalidCustomer') }, { status: 400 });
  }

  try {
    const admin = supabaseAdmin();
    const { error: schemaError } = await admin
      .from('platform_user_provisioning_log')
      .select('user_id', { head: true })
      .limit(1);
    if (schemaError) {
      console.error(
        '[platform-provision] audit schema unavailable:',
        schemaError.code
      );
      return Response.json({ error: t('setupRequired') }, { status: 503 });
    }

    const password = `${randomBytes(24).toString('base64url')}aA1!`;
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name },
      app_metadata: { wacrm_provisioned_by: actor.id },
    });
    if (error) {
      if (
        error.code === 'email_exists' ||
        error.code === 'user_already_exists'
      ) {
        return Response.json({ error: t('emailExists') }, { status: 409 });
      }
      console.error('[platform-provision] Auth rejected creation:', error.code);
      return Response.json({ error: t('createFailed') }, { status: 502 });
    }

    return Response.json(
      { email, password },
      {
        status: 201,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  } catch {
    return Response.json({ error: t('createFailed') }, { status: 502 });
  }
}
