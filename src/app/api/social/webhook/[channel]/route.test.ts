import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  after: vi.fn(),
  dispatch: vi.fn(),
  record: vi.fn(),
}))

vi.mock('next/server', () => ({ after: h.after }))
vi.mock('@/lib/ai/auto-reply', () => ({ dispatchInboundToAiReply: h.dispatch }))
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    rpc: h.record,
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: { id: 'thread-1', contact_id: 'contact-1', user_id: 'owner-1' },
          error: null,
        }),
      }
      return query
    },
  }),
}))

import { POST } from './route'

const secret = 'synthetic-instagram-secret'

beforeEach(() => {
  vi.clearAllMocks()
  h.record.mockResolvedValue({ data: 'message-1', error: null })
  vi.stubEnv('SOCIAL_INSTAGRAM_WORKSPACE_ID', 'account-1')
  vi.stubEnv('SOCIAL_INSTAGRAM_ACCOUNT_ID', 'instagram-1')
  vi.stubEnv('SOCIAL_INSTAGRAM_ACCOUNT_LABEL', 'Test Instagram')
  vi.stubEnv('SOCIAL_INSTAGRAM_ACCESS_TOKEN', 'synthetic-token')
  vi.stubEnv('SOCIAL_INSTAGRAM_APP_SECRET', secret)
  vi.stubEnv('SOCIAL_INSTAGRAM_VERIFY_TOKEN', 'synthetic-verify-token')
})

afterEach(() => vi.unstubAllEnvs())

function event(outgoing = false, signingSecret = secret) {
  const sender = { id: 'customer-1' }
  const account = { id: 'instagram-1' }
  const body = JSON.stringify({
    object: 'instagram',
    entry: [{ id: account.id, messaging: [{
      sender: outgoing ? account : sender,
      recipient: outgoing ? sender : account,
      timestamp: Date.now() - 100,
      message: { mid: 'mid-1', text: 'Hello', is_echo: outgoing },
    }] }],
  })
  return POST(new Request('http://localhost/api/social/webhook/instagram', {
    method: 'POST',
    body,
    headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', signingSecret).update(body).digest('hex')}` },
  }), { params: Promise.resolve({ channel: 'instagram' }) })
}

it('persists a signed Instagram inbound before dispatching it to the configured responder', async () => {
  expect((await event()).status).toBe(200)
  expect(h.record).toHaveBeenCalledWith('record_social_message', expect.objectContaining({
    p_account_id: 'account-1', p_message_id: 'mid-1', p_outgoing: false,
  }))
  expect(h.dispatch).not.toHaveBeenCalled()
  await h.after.mock.calls[0][0]()
  expect(h.dispatch).toHaveBeenCalledWith({
    accountId: 'account-1', conversationId: 'thread-1', contactId: 'contact-1',
    configOwnerUserId: 'owner-1', inboundMessageId: 'instagram:mid-1', channel: 'instagram',
  })
})

it('persists an outgoing echo without triggering the responder', async () => {
  expect((await event(true)).status).toBe(200)
  expect(h.record).toHaveBeenCalledWith('record_social_message', expect.objectContaining({ p_outgoing: true }))
  expect(h.after).not.toHaveBeenCalled()
})

it('does not persist or dispatch an unsigned event', async () => {
  expect((await event(false, 'wrong-fixture-secret')).status).toBe(401)
  expect(h.record).not.toHaveBeenCalled()
  expect(h.after).not.toHaveBeenCalled()
})
