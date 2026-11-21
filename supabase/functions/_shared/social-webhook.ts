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
