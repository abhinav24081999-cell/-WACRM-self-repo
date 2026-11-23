import { NextResponse } from 'next/server';
import { isUuid } from '@/lib/api/v1/pagination';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  checkWebhookUrl,
  generateWebhookSecret,
  WEBHOOK_PUBLIC_COLUMNS,
} from '@/lib/webhooks/endpoints';
import { normalizeEvents } from '@/lib/webhooks/events';
import { normalizeWebhookFields } from '@/lib/webhooks/payload';
import { isDeliverableUrl } from '@/lib/webhooks/ssrf';
import { testWebhookDelivery } from '@/lib/webhooks/deliver';
import { encrypt } from '@/lib/whatsapp/encryption';

const PUBLIC_COLUMNS = WEBHOOK_PUBLIC_COLUMNS + ', name, payload_fields';

function failure(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  try {
    const { accountId, supabase } = await requireRole('admin');
    const id = new URL(request.url).searchParams.get('id');
    if (id === null) {
      const { data, error } = await supabase
        .from('webhook_endpoints')
        .select(PUBLIC_COLUMNS)
        .eq('account_id', accountId)
        .order('created_at', { ascending: false });
      return error
        ? failure('Could not load webhooks.', 500)
        : NextResponse.json({ endpoints: data });
    }

    if (!isUuid(id)) return failure('Webhook not found.', 404);
    const { data: endpoint, error: endpointError } = await supabase
      .from('webhook_endpoints')
      .select('id')
      .eq('account_id', accountId)
      .eq('id', id)
      .maybeSingle();
    if (endpointError) return failure('Could not load this webhook.', 500);
    if (!endpoint) return failure('Webhook not found.', 404);

    const { data, error } = await supabaseAdmin()
      .from('webhook_deliveries')
      .select('event, response_status, result, created_at')
      .eq('endpoint_id', id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(25);
    return error
      ? failure('Could not load delivery history.', 500)
      : NextResponse.json({ deliveries: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { accountId, userId, supabase } = await requireRole('admin');
    const limit = checkRateLimit(
      'webhook-manager:' + userId,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return failure('Enter webhook settings.');

    const id = typeof body.id === 'string' ? body.id : '';
    if (id && !isUuid(id)) return failure('Webhook not found.', 404);

    if (
      body.action === 'test' ||
      body.action === 'rotate' ||
      body.action === 'delete'
    ) {
      if (!id) return failure('Webhook not found.', 404);

      if (body.action === 'delete') {
        const { data, error } = await supabase
          .from('webhook_endpoints')
          .delete()
          .eq('account_id', accountId)
          .eq('id', id)
          .select('id')
          .maybeSingle();
        if (error) return failure('Could not delete this webhook.', 500);
        return data
          ? NextResponse.json({ ok: true })
          : failure('Webhook not found.', 404);
      }

      if (body.action === 'rotate') {
        const secret = generateWebhookSecret();
        const { data, error } = await supabase
          .from('webhook_endpoints')
          .update({
            secret: encrypt(secret),
            is_active: false,
            failure_count: 0,
          })
          .eq('account_id', accountId)
          .eq('id', id)
          .select('id')
          .maybeSingle();
        if (error) return failure('Could not rotate the signing secret.', 500);
        return data
          ? NextResponse.json({ secret })
          : failure('Webhook not found.', 404);
      }

      const { data, error } = await supabase
        .from('webhook_endpoints')
        .select('id, url, secret')
        .eq('account_id', accountId)
        .eq('id', id)
        .maybeSingle();
      if (error) return failure('Could not load this webhook.', 500);
      if (!data) return failure('Webhook not found.', 404);
      const delivery = await testWebhookDelivery(
        supabaseAdmin(),
        accountId,
        data
      );
      return NextResponse.json({ delivery });
    }

    if (body.action === 'toggle') {
      if (!id || typeof body.active !== 'boolean')
        return failure('Choose a delivery status.');
      const { data, error } = await supabase
        .from('webhook_endpoints')
        .update(
          body.active
            ? { is_active: true, failure_count: 0 }
            : { is_active: false }
        )
        .eq('account_id', accountId)
        .eq('id', id)
        .select('id')
        .maybeSingle();
      if (error) return failure('Could not update delivery status.', 500);
      return data
        ? NextResponse.json({ ok: true })
        : failure('Webhook not found.', 404);
    }

    if (body.action !== 'save') return failure('Choose a webhook action.');
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const url = checkWebhookUrl(body.url);
    const events = normalizeEvents(body.events);
    const payloadFields =
      body.payloadFields === null && id
        ? null
        : normalizeWebhookFields(body.payloadFields);
    if (!name || name.length > 80)
      return failure('Enter a webhook name of up to 80 characters.');
    if (!url.ok) return failure(url.message);
    if (url.url.length > 2048 || new URL(url.url).hash)
      return failure('Use an HTTPS destination without a URL fragment.');
    if (!events) return failure('Choose at least one event.');
    if (!payloadFields && body.payloadFields !== null)
      return failure('Choose supported payload fields.');
    if (!id && !payloadFields)
      return failure('Choose supported payload fields.');
    if (!(await isDeliverableUrl(url.url)))
      return failure('The destination must resolve to a public HTTPS address.');

    const settings = {
      name,
      url: url.url,
      events,
      payload_fields: payloadFields,
    };
    if (id) {
      const { data, error } = await supabase
        .from('webhook_endpoints')
        .update(settings)
        .eq('account_id', accountId)
        .eq('id', id)
        .select('id')
        .maybeSingle();
      if (error) return failure('Could not save this webhook.', 500);
      return data
        ? NextResponse.json({ ok: true })
        : failure('Webhook not found.', 404);
    }

    const secret = generateWebhookSecret();
    const { error } = await supabase
      .from('webhook_endpoints')
      .insert({
        ...settings,
        account_id: accountId,
        created_by: userId,
        secret: encrypt(secret),
        is_active: false,
      });
    return error
      ? failure('Could not create this webhook.', 500)
      : NextResponse.json({ secret }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
