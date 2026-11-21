import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SocialChannel } from './channels'

export { readMessages } from '../../../supabase/functions/_shared/social-webhook'

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

function instagramHandle(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9._]{1,30}$/.test(value) ? `@${value}` : null
}

async function readGraphProfile(url: string, accessToken: string) {
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(2000),
    })
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

export async function fetchContactName(
  channel: SocialChannel,
  accessToken: string,
  senderId: string,
  messageId?: string,
): Promise<string | null> {
  const id = encodeURIComponent(senderId)
  if (channel === 'messenger') {
    const profile = await readGraphProfile(`${graphBase}/${id}?fields=first_name,last_name`, accessToken)
    return [profile?.first_name, profile?.last_name]
      .filter((name): name is string => typeof name === 'string')
      .join(' ').trim().slice(0, 255) || null
  }

  const profile = await readGraphProfile(`${graphBase}/${id}?fields=username`, accessToken)
  const username = instagramHandle(profile?.username)
  if (username) return username

  if (messageId) {
    const mid = encodeURIComponent(messageId)
    const message = await readGraphProfile(`${graphBase}/${mid}?fields=from`, accessToken)
    const fromHandle = message?.from?.id === senderId ? instagramHandle(message.from.username) : null
    if (fromHandle) return fromHandle
  }

  // The Meta dashboard can also issue an Instagram user token for this account.
  const instagramProfile = await readGraphProfile(`https://graph.instagram.com/v27.0/${id}?fields=username`, accessToken)
  return instagramHandle(instagramProfile?.username)
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
