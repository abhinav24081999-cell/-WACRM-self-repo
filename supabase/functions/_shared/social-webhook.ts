import { enrichAd, metaText, referralAttribution } from './meta-ad-attribution.ts'

interface MetaDelivery {
  object?: string
  entry?: {
    id?: string
    messaging?: SocialEvent[]
    changes?: { field?: string; value?: SocialEvent }[]
  }[]
}

interface SocialEvent {
  sender?: { id?: string }
  recipient?: { id?: string }
  timestamp?: number
  is_self?: boolean
  referral?: Record<string, unknown>
  postback?: { mid?: string; referral?: Record<string, unknown> }
  message?: {
    mid?: string
    text?: string
    is_echo?: boolean
    is_deleted?: boolean
    attachments?: unknown[]
    referral?: Record<string, unknown>
  }
}

export function readMessages(payload: MetaDelivery | null, channel: 'instagram' | 'messenger', accountId: string) {
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

export function readAdReferrals(payload: MetaDelivery | null, channel: 'instagram' | 'messenger', accountId: string) {
  const referrals = new Map<string, { senderId: string; eventKey: string; attribution: Record<string, string> }>()
  if (payload?.object !== (channel === 'messenger' ? 'page' : 'instagram') || !Array.isArray(payload.entry)) return referrals
  for (const entry of payload.entry) {
    if (!entry || (channel === 'messenger' && entry.id !== accountId)) continue
    const changes = Array.isArray(entry.changes) ? entry.changes.filter(change =>
      ['messages', 'messaging_referrals', 'messaging_postbacks'].includes(change?.field ?? ''),
    ).map(change => change.value) : []
    for (const event of [...(Array.isArray(entry.messaging) ? entry.messaging : []), ...changes]) {
      if (!event || event.is_self || event.message?.is_echo || event.message?.is_deleted || event.recipient?.id !== accountId) continue
      const senderId = metaText(event.sender?.id)
      if (!senderId || senderId === accountId) continue
      const referral = event.message?.referral ?? event.postback?.referral ?? event.referral
      if (!referral) continue
      const attribution = referralAttribution(referral)
      if (!Object.keys(attribution).length) continue

      const timestamp = new Date(event.timestamp ?? NaN).getTime()
      const mid = metaText(event.message?.mid ?? event.postback?.mid, 512)
      if (!Number.isFinite(timestamp) && !mid) continue
      const eventKey = Number.isFinite(timestamp)
        ? `time:${timestamp}:${attribution.ad_id ?? ''}`
        : `message:${mid}`
      referrals.set(`${senderId}:${eventKey}`, { senderId, eventKey, attribution })
    }
  }
  return referrals
}

export async function socialLeadArgs(
  referral: { senderId: string; eventKey: string; attribution: Record<string, string> },
  channel: 'instagram' | 'messenger',
  connection: { workspaceId: string; accountId: string; accountLabel: string },
  adsToken?: string,
) {
  return {
    p_account_id: connection.workspaceId,
    p_channel: channel,
    p_channel_account_id: connection.accountId,
    p_channel_account_label: connection.accountLabel,
    p_sender_id: referral.senderId,
    p_event_key: referral.eventKey,
    p_attribution: await enrichAd(referral.attribution, adsToken),
  }
}
