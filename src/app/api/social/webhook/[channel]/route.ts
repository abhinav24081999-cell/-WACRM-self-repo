import { supabaseAdmin } from '@/lib/flows/admin-client'
import { isSocialChannel } from '@/lib/social/channels'
import { connectionFor, fetchContactName, readMessages, validSignature } from '@/lib/social/meta'
import { verifyTokenMatches } from '@/lib/whatsapp/webhook-signature'

type Context = { params: Promise<{ channel: string }> }

export async function GET(request: Request, { params }: Context) {
  const { channel } = await params
  const connection = isSocialChannel(channel) ? connectionFor(channel) : null
  const query = new URL(request.url).searchParams
  const token = query.get('hub.verify_token')
  const challenge = query.get('hub.challenge')
  if (!connection || !token || !challenge || query.get('hub.mode') !== 'subscribe' ||
      !verifyTokenMatches(connection.verifyToken, token)) {
    return new Response(null, { status: 403 })
  }
  return new Response(challenge)
}

export async function POST(request: Request, { params }: Context) {
  const { channel } = await params
  if (!isSocialChannel(channel)) return new Response(null, { status: 404 })
  const connection = connectionFor(channel)
  if (!connection) return new Response(null, { status: 503 })

  const raw = await request.text()
  if (!validSignature(raw, request.headers.get('x-hub-signature-256'), connection.appSecret)) {
    return new Response(null, { status: 401 })
  }

  try {
    const db = supabaseAdmin()
    for (const message of readMessages(JSON.parse(raw), channel, connection.accountId)) {
      let contactName: string | null = null
      if (!message.outgoing) {
        const { data, error } = await db.from('conversations').select('id')
          .eq('account_id', connection.workspaceId)
          .eq('channel', channel)
          .eq('channel_account_id', connection.accountId)
          .eq('channel_sender_id', message.senderId)
          .maybeSingle()
        if (error) throw error
        if (!data) {
          contactName = await fetchContactName(channel, connection.accessToken, message.senderId)
        }
      }

      const { error } = await db.rpc('record_social_message', {
        p_account_id: connection.workspaceId,
        p_channel: channel,
        p_channel_account_id: connection.accountId,
        p_channel_account_label: connection.accountLabel,
        p_sender_id: message.senderId,
        p_message_id: message.messageId,
        p_text: message.text,
        p_sent_at: message.sentAt,
        p_outgoing: message.outgoing,
        p_agent_id: null,
        p_contact_name: contactName,
      })
      if (error) throw error
    }
  } catch (error) {
    console.error('[social] Unable to persist webhook delivery', {
      channel,
      code: error && typeof error === 'object' && 'code' in error ? error.code : undefined,
    })
    return new Response(null, { status: 500 })
  }

  return new Response('EVENT_RECEIVED')
}
