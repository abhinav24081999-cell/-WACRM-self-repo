import { isInboxChannel, type InboxChannel } from '@/lib/social/channels'

export interface AiAccountStatus {
  autoReplyOn: boolean
  channels?: InboxChannel[]
  external?: true
}

export const AI_ACCOUNT_STATUS_TTL_MS = 30_000

const statusCache = new Map<string, { status: AiAccountStatus; expiresAt: number }>()

export function invalidateAiAccountStatus(accountId?: string): void {
  if (accountId) statusCache.delete(accountId)
  else statusCache.clear()
}

export async function fetchAiAccountStatus(
  accountId: string,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<AiAccountStatus> {
  const cached = statusCache.get(accountId)
  if (cached && cached.expiresAt > now()) return cached.status
  try {
    const res = await fetchImpl('/api/ai/config', { cache: 'no-store' })
    if (!res.ok) return { autoReplyOn: false }
    const j = await res.json()
    const status: AiAccountStatus = {
      autoReplyOn: !!(j?.configured && j?.is_active && j?.auto_reply_enabled),
      ...(Array.isArray(j?.auto_reply_channels) ? { channels: j.auto_reply_channels.filter(isInboxChannel) } : {}),
      ...(j?.provider === 'n8n' ? { external: true } : {}),
    }
    statusCache.set(accountId, { status, expiresAt: now() + AI_ACCOUNT_STATUS_TTL_MS })
    return status
  } catch {
    return { autoReplyOn: false }
  }
}
