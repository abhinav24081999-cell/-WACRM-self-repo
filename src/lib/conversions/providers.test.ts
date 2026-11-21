import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { googleAccessToken, googleEventPayload, liveFeedbackEnabled, metaEventPayload, sendConversion, type ConversionEvent } from './providers'

const time = '2026-11-21T09:30:00.000Z'
const base: ConversionEvent = {
  id: '8c02c1e2-e3b0-4bf2-86d5-d9142dad1234', source: 'meta_instant_form', destination: 'QualifiedLead',
  test_mode: true, event_time: time, identifiers: { lead_id: '90071992547409999' }, attempts: 1, attempt_limit: 5,
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(time))
  vi.stubEnv('CONVERSION_META_CRM_DATASET_ID', '555')
  vi.stubEnv('CONVERSION_META_CRM_ACCESS_TOKEN', 'test-meta-token')
  vi.stubEnv('CONVERSION_META_CRM_TEST_CODE', 'TEST123')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it('uses CRM and channel-specific Meta identifiers and preserves event timestamps and IDs', () => {
  expect(metaEventPayload(base)).toEqual({
    event_name: 'QualifiedLead', event_id: base.id, event_time: Date.parse(time) / 1000,
    action_source: 'system_generated', user_data: { lead_id: '90071992547409999' },
    custom_data: { event_source: 'crm', lead_event_source: 'WACRM' },
  })
  expect(metaEventPayload({ ...base, source: 'whatsapp', identifiers: { whatsapp_business_account_id: '11', ctwa_clid: 'click' } })).toMatchObject({
    action_source: 'business_messaging', messaging_channel: 'whatsapp', user_data: { whatsapp_business_account_id: '11', ctwa_clid: 'click' },
  })
  expect(metaEventPayload({ ...base, source: 'instagram_dm', identifiers: { account_id: '22', sender_id: '33' } })).toMatchObject({
    messaging_channel: 'instagram', user_data: { instagram_business_account_id: '22', ig_sid: '33' },
  })
  expect(metaEventPayload({ ...base, source: 'messenger', identifiers: { account_id: '44', sender_id: '55' } })).toMatchObject({
    messaging_channel: 'messenger', user_data: { page_id: '44', page_scoped_user_id: '55' },
  })
})

it('sends Meta test events to the configured dataset and classifies throttling as retryable', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: { code: 4 } }, { status: 400 }))
    .mockResolvedValueOnce(Response.json({ events_received: 1, fbtrace_id: 'trace' }))
  vi.stubGlobal('fetch', fetcher)
  await expect(sendConversion(base, vi.fn())).rejects.toMatchObject({ reason: 'meta_error_4', retryable: true })
  await expect(sendConversion({ ...base, attempts: 2 }, vi.fn())).resolves.toBe('trace')
  const [url, request] = fetcher.mock.calls[0]
  expect(url).toBe('https://graph.facebook.com/v27.0/555/events')
  expect(request.headers.Authorization).toBe('Bearer test-meta-token')
  expect(JSON.parse(request.body)).toMatchObject({ test_event_code: 'TEST123' })
  expect(request.body).toBe(fetcher.mock.calls[1][1].body)
})

it('rejects an unconfigured test code or a messaging asset mismatch before contacting Meta', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  vi.stubEnv('CONVERSION_META_CRM_TEST_CODE', '')
  vi.stubEnv('CONVERSION_META_MESSENGER_DATASET_ID', '22')
  vi.stubEnv('CONVERSION_META_MESSENGER_ACCESS_TOKEN', 'messenger-secret')
  vi.stubEnv('CONVERSION_META_MESSENGER_ACCOUNT_ID', '11')
  await expect(sendConversion(base, vi.fn())).rejects.toMatchObject({ reason: 'meta_test_code_missing' })
  await expect(sendConversion({ ...base, source: 'messenger', identifiers: { account_id: '99' } }, vi.fn()))
    .rejects.toMatchObject({ reason: 'meta_business_account_mismatch' })
  expect(fetcher).not.toHaveBeenCalled()
})

it('uses Google Data Manager validation, click IDs and a stable transaction ID', async () => {
  const event = { ...base, source: 'google_lead_form', destination: '123', identifiers: { wbraid: 'click', leadId: 'google-lead' } }
  const expected = googleEventPayload(event, '1234567890', '9876543210')
  expect(expected).toEqual({
    destinations: [{ operatingAccount: { accountType: 'GOOGLE_ADS', accountId: '1234567890' },
      loginAccount: { accountType: 'GOOGLE_ADS', accountId: '9876543210' }, productDestinationId: '123' }],
    events: [{ eventTimestamp: time, transactionId: base.id, eventSource: 'OTHER', adIdentifiers: event.identifiers }],
    validateOnly: true,
  })
  vi.stubEnv('CONVERSION_GOOGLE_CUSTOMER_ID', '123-456-7890')
  vi.stubEnv('CONVERSION_GOOGLE_MANAGER_ID', '9876543210')
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({}))
  vi.stubGlobal('fetch', fetcher)
  await expect(sendConversion(event, async () => 'fake-oauth')).resolves.toBeNull()
  expect(fetcher.mock.calls[0][0]).toBe('https://datamanager.googleapis.com/v1/events:ingest')
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(expected)
})

it('requests a scoped OAuth token and keeps live sending disabled on Vercel previews', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  vi.stubEnv('CONVERSION_GOOGLE_PRIVATE_KEY', privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())
  vi.stubEnv('CONVERSION_GOOGLE_CLIENT_EMAIL', 'fixture@example.test')
  vi.stubEnv('CONVERSION_FEEDBACK_ALLOW_LIVE', 'true')
  vi.stubEnv('VERCEL_ENV', 'preview')
  expect(liveFeedbackEnabled()).toBe(false)
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ access_token: 'oauth' }))
  vi.stubGlobal('fetch', fetcher)
  expect(await googleAccessToken()).toBe('oauth')
  const [endpoint, request] = fetcher.mock.calls[0]
  const jwt = new URLSearchParams(request.body).get('assertion')!
  expect(endpoint).toBe('https://oauth2.googleapis.com/token')
  expect(JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'))).toMatchObject({
    iss: 'fixture@example.test', scope: 'https://www.googleapis.com/auth/datamanager', aud: endpoint,
  })
})

it('sends same-second CRM intake after original Meta lead creation without future timestamps', async () => {
  const event = { ...base, event_time: '2026-11-21T09:30:00.500Z',
    identifiers: { ...base.identifiers, provider_created_at: time } }
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ events_received: 1, fbtrace_id: 'trace' }))
  vi.stubGlobal('fetch', fetcher)
  vi.setSystemTime(new Date(event.event_time))
  await expect(sendConversion({ ...event, event_time: time }, vi.fn())).rejects.toMatchObject({ reason: 'meta_event_precedes_lead' })
  await expect(sendConversion(event, vi.fn())).rejects.toMatchObject({ reason: 'meta_event_timestamp_pending', retryable: true })
  expect(fetcher).not.toHaveBeenCalled()
  vi.setSystemTime(new Date('2026-11-21T09:30:01.000Z'))
  await expect(sendConversion(event, vi.fn())).resolves.toBe('trace')
  expect(JSON.parse(fetcher.mock.calls[0][1].body).data[0].event_time).toBe(Date.parse(time) / 1000 + 1)
})
