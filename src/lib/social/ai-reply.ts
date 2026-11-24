import type { SupabaseClient } from '@supabase/supabase-js'
import { canReplyAt, connectionFor, sendSocialText } from './meta'
import type { SocialChannel } from './channels'

export async function sendSocialAiReply(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  channel: SocialChannel,
  text: string,
) {
  const connection = connectionFor(channel)
  if (!connection || connection.workspaceId !== accountId) return

  const { data: thread, error } = await db.from('conversations')
    .select('channel_sender_id, last_inbound_at')
    .eq('id', conversationId).eq('account_id', accountId)
    .eq('channel', channel).eq('channel_account_id', connection.accountId)
    .eq('ai_autoreply_disabled', false).is('assigned_agent_id', null)
    .maybeSingle()
  if (error) throw error
  if (!thread?.channel_sender_id || !canReplyAt(thread.last_inbound_at)) return

  const reply = Array.from(text).slice(0, 1000).join('')
  const providerId = await sendSocialText(connection, thread.channel_sender_id, reply)
  if (!providerId) throw new Error('Meta rejected the social reply.')

  const { data: messageId, error: saveError } = await db.rpc('record_social_message', {
    p_account_id: accountId,
    p_channel: channel,
    p_channel_account_id: connection.accountId,
    p_channel_account_label: connection.accountLabel,
    p_sender_id: thread.channel_sender_id,
    p_message_id: providerId,
    p_text: reply,
    p_sent_at: new Date().toISOString(),
    p_outgoing: true,
    p_agent_id: null,
  })
  if (saveError || !messageId) throw new Error('Meta accepted the social reply but it could not be saved.')

  const { error: labelError } = await db.from('messages').update({ ai_generated: true })
    .eq('id', messageId).eq('conversation_id', conversationId)
  if (labelError) throw labelError
}
