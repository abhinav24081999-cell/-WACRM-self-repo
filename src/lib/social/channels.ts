export const channelLabels = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  messenger: 'Messenger',
} as const

export type InboxChannel = keyof typeof channelLabels
export type SocialChannel = Exclude<InboxChannel, 'whatsapp'>

export function isSocialChannel(value: unknown): value is SocialChannel {
  return value === 'instagram' || value === 'messenger'
}

export function channelLabel(channel: InboxChannel = 'whatsapp', accountLabel?: string | null) {
  return accountLabel ? `${channelLabels[channel]} · ${accountLabel}` : channelLabels[channel]
}
