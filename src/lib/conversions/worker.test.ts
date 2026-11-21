import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const { claim, update } = vi.hoisted(() => ({ claim: vi.fn(), update: vi.fn() }))
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => ({
  rpc: claim,
  from: () => ({ update: (values: unknown) => {
    const filters: Record<string, string | number> = {}
    const chain = {
      eq(key: string, value: string | number) { filters[key] = value; return chain },
      then(resolve: (value: { error: null }) => void) { update(values, filters); resolve({ error: null }) },
    }
    return chain
  } }),
}) }))

import { GET } from '@/app/api/conversion-feedback/cron/route'

const now = '2026-11-21T10:00:00.000Z'
const row = {
  id: 'event-id', source: 'meta_instant_form', destination: 'QualifiedLead', test_mode: true,
  event_time: now, identifiers: { lead_id: '123456789012345678' }, attempts: 1, attempt_limit: 5,
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(now))
  vi.stubEnv('CONVERSION_FEEDBACK_WORKSPACE_ID', 'test-workspace')
  vi.stubEnv('CONVERSION_FEEDBACK_ALLOW_LIVE', 'true')
  vi.stubEnv('VERCEL_ENV', 'preview')
  vi.stubEnv('CONVERSION_META_CRM_DATASET_ID', '123')
  vi.stubEnv('CONVERSION_META_CRM_ACCESS_TOKEN', 'fake-token')
  vi.stubEnv('CONVERSION_META_CRM_TEST_CODE', 'TEST123')
  vi.stubEnv('CRON_SECRET', 'cron-test')
  claim.mockResolvedValue({ data: [row], error: null })
})

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

const call = (secret = 'cron-test') => GET(new Request('http://localhost/api/conversion-feedback/cron', {
  headers: { Authorization: `Bearer ${secret}` },
}))

it('checks the cron secret and scopes claims to test events in the configured workspace', async () => {
  expect((await call('invalid')).status).toBe(401)
  expect(claim).not.toHaveBeenCalled()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ events_received: 1, fbtrace_id: 'trace' })))
  expect(await (await call()).json()).toMatchObject({ processed: 1, tested: 1, accepted: 0 })
  expect(claim).toHaveBeenCalledWith('claim_conversion_feedback', { p_account_id: 'test-workspace', p_allow_live: false })
  expect(update).toHaveBeenCalledWith({ state: 'tested', reason: null, response_id: 'trace', lease_until: null },
    { id: row.id, state: 'sending', attempts: 1, account_id: 'test-workspace' })
})

it('retries throttled events with backoff and retains the same event identity', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({}, { status: 429 }))
  vi.stubGlobal('fetch', fetcher)
  expect(await (await call()).json()).toMatchObject({ retrying: 1 })
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ state: 'retrying', available_at: '2026-11-21T10:02:00.000Z' }),
    expect.objectContaining({ id: row.id, attempts: 1 }))
  claim.mockResolvedValue({ data: [{ ...row, attempts: 5 }], error: null })
  expect(await (await call()).json()).toMatchObject({ failed: 1 })
  expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body)
})
