import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => ({ rpc }) }))

import { POST as googlePost } from '@/app/api/google/leads/webhook/route'
import { POST as websitePost } from '@/app/api/leads/website/route'

const googlePayload = `{
  "google_key":"google-key","lead_id":"lead:example","campaign_id":90071992547409999,
  "adgroup_id":0,"creative_id":"98002","form_id":120001,"gcl_id":"test-click",
  "user_column_data":[
    {"column_id":"FULL_NAME","string_value":"Fixture Lead"},
    {"column_id":"PHONE_NUMBER","string_value":"+91 99900 00001"},
    {"column_id":"PRODUCT","string_value":"Demat"}
  ]
}`

function request(path: string, body: string, token?: string) {
  return new Request(`http://localhost${path}`, {
    method: 'POST', body,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
}

beforeEach(() => {
  vi.stubEnv('GOOGLE_LEAD_WORKSPACE_ID', 'workspace-for-tests')
  vi.stubEnv('GOOGLE_LEAD_WEBHOOK_KEY', 'google-key')
  vi.stubEnv('WEBSITE_LEAD_WEBHOOK_KEY', 'website-secret')
  rpc.mockResolvedValue({ error: null })
})

afterEach(() => vi.unstubAllEnvs())

describe('Google Ads Lead Form intake', () => {
  const post = (body: string) => googlePost(request('/api/google/leads/webhook', body))

  it('preserves 64-bit campaign IDs and the Google click ID, and ignores placeholder zeros', async () => {
    expect((await post(googlePayload)).status).toBe(200)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('record_google_or_website_lead', {
      p_account_id: 'workspace-for-tests', p_source: 'google_lead_form', p_event_id: 'lead:example',
      p_name: 'Fixture Lead', p_phone: '+919990000001', p_email: '', p_ads_platform: 'google',
      p_attribution: { campaign_id: '90071992547409999', ad_id: '98002', form_id: '120001', gclid: 'test-click' },
      p_form_answers: [
        { name: 'FULL_NAME', values: ['Fixture Lead'] },
        { name: 'PHONE_NUMBER', values: ['+91 99900 00001'] },
        { name: 'PRODUCT', values: ['Demat'] },
      ],
    })
  })

  it('rejects the wrong key or malformed JSON and acknowledges Google test payloads without saving', async () => {
    expect((await post(googlePayload.replace('google-key', 'website-secret'))).status).toBe(401)
    expect((await post('{')).status).toBe(400)
    expect((await post(googlePayload.replace('"lead_id":"lead:example"', '"lead_id":null'))).status).toBe(400)
    expect(await (await post(googlePayload.replace('{', '{"is_test":true,'))).json()).toEqual({ status: 'test_received' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns a retryable response when the write fails', async () => {
    rpc.mockResolvedValueOnce({ error: { code: 'test-failure' } })
    expect((await post(googlePayload)).status).toBe(503)
    expect((await post(googlePayload)).status).toBe(200)
  })
})

describe('Website form intake', () => {
  const post = (body: object, token = 'website-secret') => websitePost(request('/api/leads/website', JSON.stringify(body), token))

  it('keeps Google and UTM attribution, strips URL query strings, and routes to the configured workspace', async () => {
    expect((await post({
      submission_id: 'submission-1', account_id: 'another-workspace', email: 'TEST@example.test', form_id: 'bankshakha-test-form',
      attribution: { gbraid: 'braid', campaign_id: '123', utm_campaign: 'demat', landing_url: 'https://example.test/demat?email=private#details' },
      answers: { product: ['Demat', 'Insurance'] },
    })).status).toBe(200)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('record_google_or_website_lead', {
      p_account_id: 'workspace-for-tests', p_source: 'website_form', p_event_id: 'submission-1',
      p_name: '', p_phone: '', p_email: 'test@example.test', p_ads_platform: 'google',
      p_attribution: { campaign_id: '123', gbraid: 'braid', utm_campaign: 'demat', form_id: 'bankshakha-test-form', landing_url: 'https://example.test/demat' },
      p_form_answers: [{ name: 'product', values: ['Demat', 'Insurance'] }],
    })
  })

  it('keeps unproven ad attribution unknown and rejects invalid contacts or a key from the other route', async () => {
    const body = { submission_id: 'submission-2', phone: '+91 99900 00001', attribution: { utm_source: 'google', utm_medium: 'organic' } }
    expect((await post(body, 'google-key')).status).toBe(401)
    expect((await post({ ...body, phone: '9990000001' })).status).toBe(400)
    expect((await post(body)).status).toBe(200)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('record_google_or_website_lead', expect.objectContaining({
      p_ads_platform: null, p_attribution: { utm_source: 'google', utm_medium: 'organic' },
    }))
  })
})
