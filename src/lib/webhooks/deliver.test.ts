import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (s: string) => s,
  encrypt: (s: string) => s,
}));

vi.mock('./post', () => ({
  BlockedWebhookDestination: class extends Error {},
  postWebhook: vi.fn(),
}));

import { dispatchWebhookEvent, MAX_CONSECUTIVE_FAILURES } from './deliver';
import { BlockedWebhookDestination, postWebhook } from './post';

const post = vi.mocked(postWebhook);

interface Row {
  id: string;
  url: string;
  secret: string;
}
interface Calls {
  updates: { id: string; payload: Record<string, unknown> }[];
  rpcs: { name: string; args: Record<string, unknown> }[];
}

function makeDb(rows: Row[], calls: Calls) {
  const from = () => {
    let mode: 'select' | 'update' = 'select';
    let payload: Record<string, unknown> = {};
    let id: string | null = null;
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (col: string, val: string) => {
        if (col === 'id') id = val;
        return b;
      },
      update: (p: Record<string, unknown>) => {
        mode = 'update';
        payload = p;
        return b;
      },
      contains: () => Promise.resolve({ data: rows, error: null }),
      then: (resolve: (v: unknown) => unknown) => {
        if (mode === 'update' && id) calls.updates.push({ id, payload });
        return resolve({ data: null, error: null });
      },
    };
    return b;
  };
  const rpc = (name: string, args: Record<string, unknown>) => {
    calls.rpcs.push({ name, args });
    return Promise.resolve({ data: null, error: null });
  };
  return { from, rpc } as unknown as SupabaseClient;
}

const emptyCalls = (): Calls => ({ updates: [], rpcs: [] });

beforeEach(() => {
  post.mockReset().mockResolvedValue({ status: 200, body: '' });
});
describe('dispatchWebhookEvent', () => {
  it('signs + POSTs (no redirect follow) and resets failure_count on success', async () => {
    const calls = emptyCalls();

    await dispatchWebhookEvent(
      makeDb([{ id: 'a', url: 'https://a.test/hook', secret: 's1' }], calls),
      'acct-1',
      'message.received',
      { x: 1 }
    );

    expect(post).toHaveBeenCalledTimes(1);
    const [url, headers, body] = post.mock.calls[0];
    expect(url).toBe('https://a.test/hook');
    expect(headers['X-Wacrm-Event']).toBe('message.received');
    expect(headers['X-Wacrm-Signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    // Payload carries a dedupe id.
    expect(JSON.parse(body).id).toMatch(/[0-9a-f-]{36}/);
    expect(calls.updates[0]).toMatchObject({
      id: 'a',
      payload: { failure_count: 0 },
    });
    expect(calls.rpcs.map((r) => r.name)).toEqual(['log_webhook_delivery']);
  });

  it('records an atomic failure (RPC) when the endpoint errors', async () => {
    post.mockResolvedValueOnce({ status: 500, body: '' });
    const calls = emptyCalls();

    await dispatchWebhookEvent(
      makeDb([{ id: 'b', url: 'https://b.test/hook', secret: 's2' }], calls),
      'acct-1',
      'message.received',
      {}
    );

    expect(calls.rpcs[1]).toEqual({
      name: 'record_webhook_failure',
      args: { endpoint_id: 'b', max_failures: MAX_CONSECUTIVE_FAILURES },
    });
    expect(calls.updates).toHaveLength(0);
  });

  it('blocks a non-public target (SSRF guard) without fetching', async () => {
    post.mockRejectedValueOnce(new BlockedWebhookDestination());
    const calls = emptyCalls();

    await dispatchWebhookEvent(
      makeDb([{ id: 'c', url: 'https://127.0.0.1/hook', secret: 's3' }], calls),
      'acct-1',
      'message.received',
      {}
    );

    expect(calls.rpcs[0].args.p_result).toBe('blocked_destination');
    expect(calls.rpcs[1].name).toBe('record_webhook_failure');
  });

  it('does nothing when no endpoints are subscribed', async () => {
    const calls = emptyCalls();
    await dispatchWebhookEvent(
      makeDb([], calls),
      'acct-1',
      'message.received',
      {}
    );
    expect(post).not.toHaveBeenCalled();
    expect(calls.rpcs).toHaveLength(0);
    expect(calls.updates).toHaveLength(0);
  });
});
