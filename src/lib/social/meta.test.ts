import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { canReplyAt, readMessages, sendSocialText, validSignature } from './meta'

const accountId = '100'
const senderId = '200'
const timestamp = Date.parse('2026-05-01T10:00:00Z')
const incoming = {
  sender: { id: senderId },
  recipient: { id: accountId },
  timestamp,
  message: { mid: 'm-1', text: 'Hello' },
}
const echo = {
  sender: incoming.recipient,
  recipient: incoming.sender,
  timestamp,
  message: { mid: 'm-2', text: 'Hi', is_echo: true },
}

describe('Meta social channels', () => {
  it('verifies the signature against the raw request body', () => {
    const body = '{"object":"instagram"}'
    const secret = 'test-only-secret'
    const signature = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
    expect(validSignature(body, signature, secret)).toBe(true)
    expect(validSignature(body + ' ', signature, secret)).toBe(false)
    expect(validSignature(body, 'sha256=09', secret)).toBe(false)
  })

  it('routes batched Instagram events by recipient, including outgoing echoes', () => {
    expect(readMessages({
      object: 'instagram',
      entry: [{ id: 'subscription-id', messaging: [
        incoming,
        { ...incoming, recipient: { id: 'wrong-account' } },
        { ...incoming, message: { mid: 'deleted', is_deleted: true } },
        echo,
      ] }],
    }, 'instagram', accountId)).toEqual([
      { senderId, messageId: 'm-1', text: 'Hello', sentAt: new Date(timestamp).toISOString(), outgoing: false },
      { senderId, messageId: 'm-2', text: 'Hi', sentAt: new Date(timestamp).toISOString(), outgoing: true },
    ])
  })

  it('accepts Messenger conversations only for the connected Page', () => {
    const event = { object: 'page', entry: [{ id: accountId, messaging: [incoming] }] }
    expect(readMessages(event, 'messenger', accountId)).toHaveLength(1)
    expect(readMessages(event, 'messenger', 'other-page')).toHaveLength(0)
    expect(readMessages(event, 'instagram', accountId)).toHaveLength(0)
  })

  it('closes the standard reply window at 24 hours', () => {
    const sentAt = new Date(timestamp).toISOString()
    expect(canReplyAt(sentAt, timestamp + 86_399_999)).toBe(true)
    expect(canReplyAt(sentAt, timestamp + 86_400_000)).toBe(false)
    expect(canReplyAt(null, timestamp)).toBe(false)
    expect(canReplyAt(sentAt, timestamp - 1)).toBe(false)
  })

  it.each([
    ['instagram', 'instagram', {}],
    ['messenger', 'facebook', { messaging_type: 'RESPONSE' }],
  ] as const)('sends %s replies to the matching provider and recipient', async (channel, host, extra) => {
    const mock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message_id: 'sent-id' }))
    vi.stubGlobal('fetch', mock)
    try {
      await expect(sendSocialText({
        channel, workspaceId: 'test-workspace', accountId, accountLabel: 'Test',
        accessToken: 'test-token', appSecret: 'test-secret', verifyToken: 'test-verify',
      }, senderId, 'Hi')).resolves.toBe('sent-id')
      expect(mock.mock.calls[0][0]).toBe(`https://graph.${host}.com/v27.0/${accountId}/messages`)
      expect(JSON.parse(mock.mock.calls[0][1]?.body as string)).toEqual({
        ...extra, recipient: { id: senderId }, message: { text: 'Hi' },
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
