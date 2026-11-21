import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SocialChannel } from './channels'

const graphBase = 'https://graph.facebook.com/v27.0'
const replyWindowMs = 24 * 60 * 60 * 1000

export function connectionFor(channel: SocialChannel) {
  const prefix = channel === 'instagram' ? 'SOCIAL_INSTAGRAM' : 'SOCIAL_MESSENGER'
  const workspaceId = process.env[`${prefix}_WORKSPACE_ID`]?.trim()
  const accountId = process.env[`${prefix}_ACCOUNT_ID`]?.trim()
  const accountLabel = process.env[`${prefix}_ACCOUNT_LABEL`]?.trim()
  const accessToken = process.env[`${prefix}_ACCESS_TOKEN`]?.trim()
  const appSecret = process.env[`${prefix}_APP_SECRET`]?.trim()
  const verifyToken = process.env[`${prefix}_VERIFY_TOKEN`]?.trim()
  if (!workspaceId || !accountId || !accountLabel || !accessToken || !appSecret || !verifyToken) {
    return null
  }
  return { channel, workspaceId, accountId, accountLabel, accessToken, appSecret, verifyToken }
}

export function validSignature(body: string, signature: string | null, secret: string) {
  if (!signature || !/^sha256=[0-9a-f]{64}$/.test(signature)) return false
  const actual = Buffer.from(signature.slice(7), 'hex')
  const expected = createHmac('sha256', secret).update(body).digest()
  return timingSafeEqual(actual, expected)
}

export function canReplyAt(lastInboundAt: string | null, now = Date.now()) {
  const elapsed = now - Date.parse(lastInboundAt ?? '')
  return elapsed >= 0 && elapsed < replyWindowMs
}

interface MetaDelivery {
  object?: string
  entry?: {
    id?: string
    messaging?: {
      sender?: { id?: string }
      recipient?: { id?: string }
      timestamp?: number
      message?: {
        mid?: string
        text?: string
        is_echo?: boolean
        is_deleted?: boolean
        attachments?: unknown[]
      }
    }[]
  }[]
}

export function readMessages(payload: MetaDelivery | null, channel: SocialChannel, accountId: string) {
  if (payload?.object !== (channel === 'messenger' ? 'page' : 'instagram')) return []
  const messages: { senderId: string; messageId: string; text: string; sentAt: string; outgoing: boolean }[] = []

  if (!Array.isArray(payload.entry)) return messages
  for (const entry of payload.entry) {
    if (!Array.isArray(entry?.messaging) || (channel === 'messenger' && entry.id !== accountId)) continue
    for (const event of entry.messaging) {
      const message = event?.message
      if (typeof message?.mid !== 'string' || !message.mid || message.is_deleted) continue
      const outgoing = message.is_echo === true
      const senderId = outgoing ? event.recipient?.id : event.sender?.id
      const receivingAccount = outgoing ? event.sender?.id : event.recipient?.id
      if (typeof senderId !== 'string' || !senderId || receivingAccount !== accountId || senderId === accountId) continue
      const text = typeof message.text === 'string' && message.text
        ? message.text
        : Array.isArray(message.attachments) && message.attachments.length
          ? '[Attachment]'
          : '[Unsupported message]'
      const eventTime = new Date(event.timestamp ?? Date.now())
      const sentAt = Number.isFinite(eventTime.getTime())
        ? new Date(Math.min(eventTime.getTime(), Date.now())).toISOString()
        : new Date().toISOString()
      messages.push({ senderId, messageId: message.mid, text, sentAt, outgoing })
    }
  }
  return messages
}

export async function fetchContactName(
  channel: SocialChannel,
  accessToken: string,
  senderId: string,
): Promise<string | null> {
  const fields = channel === 'instagram' ? 'name,username' : 'first_name,last_name'
  try {
    const response = await fetch(`${graphBase}/${encodeURIComponent(senderId)}?fields=${fields}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(2000),
    })
    if (!response.ok) return null
    const profile = await response.json()
    const name = channel === 'instagram'
      ? profile.name || profile.username
      : [profile.first_name, profile.last_name].filter(Boolean).join(' ')
    return typeof name === 'string' ? name.trim().slice(0, 255) || null : null
  } catch {
    return null
  }
}

export async function sendSocialText(
  connection: NonNullable<ReturnType<typeof connectionFor>>,
  senderId: string,
  text: string,
) {
  const response = await fetch(`${graphBase}/${encodeURIComponent(connection.accountId)}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...(connection.channel === 'messenger' ? { messaging_type: 'RESPONSE' } : {}),
      recipient: { id: senderId },
      message: { text },
    }),
    signal: AbortSignal.timeout(10000),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok || typeof result?.message_id !== 'string') {
    console.warn('[social] Meta send rejected', { status: response.status, code: result?.error?.code })
    return null
  }
  return result.message_id as string
}
