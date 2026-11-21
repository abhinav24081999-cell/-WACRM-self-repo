import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'
import { isSocialChannel } from '@/lib/social/channels'
import { canReplyAt, connectionFor, sendSocialText } from '@/lib/social/meta'

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const limit = checkRateLimit(`send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const id = body?.conversation_id
    const text = typeof body?.content_text === 'string' ? body.content_text.trim() : ''
    if (typeof id !== 'string' || !text || text.length > 1000) {
      return Response.json({ error: 'A conversation and a reply of up to 1,000 characters are required.' }, { status: 400 })
    }

    const { data: thread, error } = await supabase.from('conversations')
      .select('channel, channel_account_id, channel_sender_id, last_inbound_at')
      .eq('id', id).eq('account_id', accountId).maybeSingle()
    if (error || !thread || !isSocialChannel(thread.channel) || !thread.channel_sender_id) {
      return Response.json({ error: 'Conversation not found.' }, { status: 404 })
    }

    const connection = connectionFor(thread.channel)
    if (!connection || connection.workspaceId !== accountId || connection.accountId !== thread.channel_account_id) {
      return Response.json({ error: 'This channel connection is unavailable.' }, { status: 503 })
    }
    if (!canReplyAt(thread.last_inbound_at)) {
      return Response.json({ error: 'The 24-hour reply window has closed.' }, { status: 409 })
    }

    let providerId: string | null
    try {
      providerId = await sendSocialText(connection, thread.channel_sender_id, text)
    } catch {
      return Response.json(
        { error: 'Could not confirm delivery. Check the conversation before retrying.' },
        { status: 502 },
      )
    }
    if (!providerId) {
      return Response.json({ error: 'Meta rejected the reply. Check the channel connection and permissions.' }, { status: 502 })
    }

    const { data: messageId, error: saveError } = await supabaseAdmin().rpc('record_social_message', {
      p_account_id: accountId,
      p_channel: connection.channel,
      p_channel_account_id: connection.accountId,
      p_channel_account_label: connection.accountLabel,
      p_sender_id: thread.channel_sender_id,
      p_message_id: providerId,
      p_text: text,
      p_sent_at: new Date().toISOString(),
      p_outgoing: true,
      p_agent_id: userId,
    })
    if (saveError || !messageId) {
      console.error('[social] Meta accepted reply but persistence failed', { code: saveError?.code })
      return Response.json(
        { error: 'Meta accepted the reply, but it has not synced here yet. Check the conversation before retrying.' },
        { status: 500 },
      )
    }
    return Response.json({ message_id: messageId })
  } catch (error) {
    return toErrorResponse(error)
  }
}
