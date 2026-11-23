import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { lookup, rpc } = vi.hoisted(() => ({ lookup: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: lookup }) }) }) }), rpc }),
}))

import { GET, POST } from './route'

const base = 'http://localhost/api/meta/leads/webhook'
const leadId = '90071992547409999'
const form = `{"field":"leadgen","value":{"page_id":123,"leadgen_id":${leadId},"form_id":99,"ad_id":555}}`
const body = `{"object":"page","entry":[{"id":123,"changes":[${form},${form}]},{"id":456,"changes":[${form}]}]}`

function delivery(secret = 'form-secret', raw = body) {
  const signature = createHmac('sha256', secret).update(raw).digest('hex')
  return new Request(base, { method: 'POST', body: raw, headers: { 'x-hub-signature-256': `sha256=${signature}` } })
}

beforeEach(() => {
  vi.stubEnv('META_LEAD_WORKSPACE_ID', 'test-workspace')
  vi.stubEnv('META_LEAD_PAGE_ID', '123')
  vi.stubEnv('META_LEAD_PAGE_ACCESS_TOKEN', 'test-token')
  vi.stubEnv('META_LEAD_APP_SECRET', 'form-secret')
  vi.stubEnv('META_LEAD_VERIFY_TOKEN', 'test-verification')
  vi.stubEnv('META_LEAD_ADS_ACCESS_TOKEN', '')
  lookup.mockResolvedValue({ data: null, error: null })
  rpc.mockResolvedValue({ error: null })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('Meta Instant Form webhook', () => {
  it('requires the verify token and signature before accessing form data', async () => {
    const verification = new URL(base)
    verification.search = 'hub.mode=subscribe&hub.challenge=hello&hub.verify_token=test-verification'
    expect(await GET(new Request(verification)).text()).toBe('hello')
    expect(GET(new Request(base)).status).toBe(403)
    expect((await POST(delivery('wrong-secret'))).status).toBe(401)
    expect((await POST(delivery('form-secret', '{'))).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('can verify the callback before lead delivery credentials are configured', async () => {
    const verification = new URL(base)
    verification.search = 'hub.mode=subscribe&hub.challenge=hello&hub.verify_token=test-verification'
    vi.stubEnv('META_LEAD_PAGE_ACCESS_TOKEN', '')
    vi.stubEnv('META_LEAD_APP_SECRET', '')
    expect(await GET(new Request(verification)).text()).toBe('hello')
    expect((await POST(delivery())).status).toBe(503)
    vi.stubEnv('META_LEAD_PAGE_ID', '')
    expect(GET(new Request(verification)).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('keeps long IDs exact, adds contact and ad data, and acknowledges a replay', async () => {
    const fetchGraph = vi.fn().mockResolvedValueOnce(Response.json({ id: leadId, platform: 'ig', field_data: [
      { name: 'full_name', values: ['Preview Lead'] }, { name: 'phone_number', values: ['+91 99900 00001'] },
      { name: 'preferred_products', values: ['Insurance', 'Demat'] },
    ] })).mockResolvedValueOnce(Response.json({ name: 'Test ad', campaign_id: '444', adset_id: '333' }))
    vi.stubGlobal('fetch', fetchGraph)

    expect((await POST(delivery())).status).toBe(200)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('record_meta_form_lead', {
      p_account_id: 'test-workspace', p_lead_id: leadId, p_name: 'Preview Lead', p_phone: '+919990000001', p_email: '',
      p_form_answers: [
        { name: 'full_name', values: ['Preview Lead'] },
        { name: 'phone_number', values: ['+91 99900 00001'] },
        { name: 'preferred_products', values: ['Insurance', 'Demat'] },
      ],
      p_attribution: { external_lead_id: leadId, meta_page_id: '123', form_id: '99', ad_id: '555',
        meta_platform: 'ig', campaign_id: '444', ad_group_id: '333', ad_name: 'Test ad' },
    })
    expect(fetchGraph.mock.calls[0][0].pathname).toBe(`/v27.0/${leadId}`)
    lookup.mockResolvedValueOnce({ data: { id: 'existing' }, error: null })
    expect((await POST(delivery())).status).toBe(200)
    expect(fetchGraph).toHaveBeenCalledTimes(2)
  })

  it('ignores another Page and returns a retryable error on Graph failure', async () => {
    const fetchGraph = vi.fn().mockResolvedValue(new Response(null, { status: 429 }))
    vi.stubGlobal('fetch', fetchGraph)
    expect((await POST(delivery('form-secret', body.replaceAll('123', '456')))).status).toBe(200)
    expect(fetchGraph).not.toHaveBeenCalled()
    expect((await POST(delivery())).status).toBe(503)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('keeps webhook attribution when the Page token cannot read ad metadata', async () => {
    const fetchGraph = vi.fn().mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ id: leadId, field_data: [] }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
    vi.stubGlobal('fetch', fetchGraph)
    expect((await POST(delivery())).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('record_meta_form_lead', expect.objectContaining({
      p_attribution: { external_lead_id: leadId, meta_page_id: '123', form_id: '99', ad_id: '555' },
    }))
  })
})
