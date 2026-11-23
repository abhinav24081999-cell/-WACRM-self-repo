export const WEBHOOK_PAYLOAD_FIELDS = {
  contact_id: 'Contact ID',
  conversation_id: 'Conversation ID',
  whatsapp_message_id: 'WhatsApp message ID',
  content_type: 'Message type',
  status: 'Delivery status',
  text: 'Message text',
} as const;

export const DEFAULT_WEBHOOK_FIELDS = [
  'contact_id',
  'conversation_id',
  'status',
] as const;

export function normalizeWebhookFields(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    value.some(
      (key) =>
        typeof key !== 'string' || !Object.hasOwn(WEBHOOK_PAYLOAD_FIELDS, key)
    )
  ) {
    return null;
  }
  return [...new Set<string>(value)];
}

export function selectWebhookFields(
  data: unknown,
  fields: string[] | null | undefined
) {
  if (!fields || !data || typeof data !== 'object') return data;
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => fields.includes(key))
  );
}
