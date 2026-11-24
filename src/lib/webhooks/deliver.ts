import { workspaceFeatureAllowed } from '@/lib/auth/workspace-entitlements'
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import { buildSignatureHeader } from './sign';
import { BlockedWebhookDestination, postWebhook } from './post';
import { selectWebhookFields } from './payload';
import type { WebhookEvent } from './events';

export const DELIVERY_TIMEOUT_MS = 5000;
export const MAX_CONSECUTIVE_FAILURES = 15;

export interface DeliveryEndpoint {
  id: string;
  url: string;
  secret: string;
  payload_fields?: string[] | null;
}

export interface WebhookDelivery {
  event: string;
  response_status: number | null;
  result:
    | 'delivered'
    | 'http_error'
    | 'network_error'
    | 'blocked_destination'
    | 'secret_error';
  created_at: string;
}

function envelope(accountId: string, event: string, data: unknown) {
  return {
    id: randomUUID(),
    event,
    occurred_at: new Date().toISOString(),
    account_id: accountId,
    data,
  };
}

async function sendDelivery(
  row: DeliveryEndpoint,
  event: string,
  body: string
) {
  let secret: string;
  try {
    secret = decrypt(row.secret);
  } catch {
    return { result: 'secret_error', response_status: null } as const;
  }
  try {
    const { status } = await postWebhook(
      row.url,
      {
        'Content-Type': 'application/json',
        'X-Wacrm-Event': event,
        'X-Wacrm-Webhook-Id': row.id,
        'X-Wacrm-Signature': buildSignatureHeader(
          body,
          secret,
          Math.floor(Date.now() / 1000)
        ),
      },
      body,
      DELIVERY_TIMEOUT_MS
    );
    return {
      result: status >= 200 && status < 300 ? 'delivered' : 'http_error',
      response_status: status,
    } as const;
  } catch (error) {
    return {
      result:
        error instanceof BlockedWebhookDestination
          ? 'blocked_destination'
          : 'network_error',
      response_status: null,
    } as const;
  }
}

async function logDelivery(
  db: SupabaseClient,
  endpointId: string,
  eventId: string,
  event: string,
  result: Awaited<ReturnType<typeof sendDelivery>>
) {
  const { error } = await db.rpc('log_webhook_delivery', {
    p_endpoint_id: endpointId,
    p_event_id: eventId,
    p_event: event,
    p_status: result.response_status,
    p_result: result.result,
  });
  if (error) console.error('[webhooks] failed to record delivery', error.code);
}

export async function testWebhookDelivery(
  db: SupabaseClient,
  accountId: string,
  endpoint: DeliveryEndpoint
) {
  const payload = envelope(accountId, 'webhook.test', { sample: true });
  const result = await sendDelivery(
    endpoint,
    'webhook.test',
    JSON.stringify({ version: 1, ...payload })
  );
  await logDelivery(db, endpoint.id, payload.id, payload.event, result);
  return result;
}

/** Best-effort fan-out. Existing public API subscriptions retain their payload shape. */
export async function dispatchWebhookEvent(
  db: SupabaseClient,
  accountId: string,
  event: WebhookEvent,
  data: unknown
): Promise<void> {
  try {
    const { data: rows, error } = await db
      .from('webhook_endpoints')
      .select('id, url, secret, payload_fields')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .contains('events', [event]);

    if (error || !rows?.length || !(await workspaceFeatureAllowed(db, accountId, 'webhooks'))) return;
    const payload = envelope(accountId, event, data);
    await Promise.allSettled(
      (rows as DeliveryEndpoint[]).map(async (row) => {
        const body = row.payload_fields
          ? {
              version: 1,
              ...payload,
              data: selectWebhookFields(data, row.payload_fields),
            }
          : payload;
        const result = await sendDelivery(row, event, JSON.stringify(body));
        await logDelivery(db, row.id, payload.id, event, result);
        if (result.result === 'delivered') {
          await db
            .from('webhook_endpoints')
            .update({
              failure_count: 0,
              last_delivery_at: new Date().toISOString(),
            })
            .eq('id', row.id);
        } else {
          await db.rpc('record_webhook_failure', {
            endpoint_id: row.id,
            max_failures: MAX_CONSECUTIVE_FAILURES,
          });
        }
      })
    );
  } catch (err) {
    console.error('[webhooks] dispatch failed:', err);
  }
}
