export const channelLabels = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  messenger: 'Messenger',
} as const

export type InboxChannel = keyof typeof channelLabels
export type SocialChannel = Exclude<InboxChannel, 'whatsapp'>

export const inboxChannels = ['whatsapp', 'instagram', 'messenger'] as const

export function isInboxChannel(value: unknown): value is InboxChannel {
  return value === 'whatsapp' || isSocialChannel(value)
}

export function isSocialChannel(value: unknown): value is SocialChannel {
  return value === 'instagram' || value === 'messenger'
}

export function channelLabel(channel: InboxChannel = 'whatsapp', accountLabel?: string | null) {
  return accountLabel ? `${channelLabels[channel]} · ${accountLabel}` : channelLabels[channel]
}

export function socialSenderLabel(channel: InboxChannel | undefined, senderId?: string | null) {
  return channel === 'messenger' && senderId ? `ID ${senderId}` : undefined
}
