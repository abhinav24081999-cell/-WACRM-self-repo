import { after } from 'next/server'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { isSocialChannel } from '@/lib/social/channels'
import { canReplyAt, connectionFor, fetchContactName, readAdReferrals, readMessages, socialLeadArgs, validSignature } from '@/lib/social/meta'
import { verifyTokenMatches } from '@/lib/whatsapp/webhook-signature'
import { adsTokenFor, captureFormLeads, formConnection, metaLeadWorkspace, readFormEvents } from '@/lib/meta/lead-ads'
import { readCappedBody } from '@/lib/whatsapp/webhook-body'

export const maxDuration = 60
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

  const raw = await readCappedBody(request)
  if (raw === null) return new Response(null, { status: 413 })
  if (!validSignature(raw, request.headers.get('x-hub-signature-256'), connection.appSecret)) {
    return new Response(null, { status: 401 })
  }

  try {
    const db = supabaseAdmin()
    const payload = JSON.parse(raw)
    const inboundForAi: Parameters<typeof dispatchInboundToAiReply>[0][] = []
    for (const message of readMessages(payload, channel, connection.accountId)) {
      let contactName: string | null = null
      const lookupThread = () => db.from('conversations').select('id, contact_id, user_id')
        .eq('account_id', connection.workspaceId)
        .eq('channel', channel)
        .eq('channel_account_id', connection.accountId)
        .eq('channel_sender_id', message.senderId)
        .maybeSingle()
      let thread = null
      if (!message.outgoing) {
        const { data, error } = await lookupThread()
        if (error) throw error
        thread = data
        if (!data) {
          contactName = await fetchContactName(channel, connection.accessToken, message.senderId, message.messageId)
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

      if (!message.outgoing && canReplyAt(message.sentAt) && message.text.trim() &&
          message.text !== '[Attachment]' && message.text !== '[Unsupported message]') {
        if (!thread) {
          const result = await lookupThread()
          if (result.error) throw result.error
          thread = result.data
        }
        if (thread) inboundForAi.push({
          accountId: connection.workspaceId,
          conversationId: thread.id,
          contactId: thread.contact_id,
          configOwnerUserId: thread.user_id,
          inboundMessageId: `${channel}:${message.messageId}`,
          channel,
        })
      }
    }
    if (connection.workspaceId === metaLeadWorkspace()) {
      for (const referral of readAdReferrals(payload, channel, connection.accountId).values()) {
        const args = await socialLeadArgs(referral, channel, connection, adsTokenFor(connection.workspaceId))
        const { error } = await db.rpc('record_meta_social_lead', args)
        if (error) throw error
      }
    }
    const forms = channel === 'messenger' ? formConnection() : null
    if (forms && forms.pageId === connection.accountId && forms.workspaceId === connection.workspaceId &&
        forms.appSecret === connection.appSecret) {
      const events = readFormEvents(raw, forms.pageId)
      if (events.size && !await captureFormLeads(events, forms)) return new Response(null, { status: 503 })
    }
    if (inboundForAi.length) after(async () => {
      await Promise.all(inboundForAi.map((inbound) => dispatchInboundToAiReply(inbound)))
    })
  } catch (error) {
    console.error('[social] Unable to persist webhook delivery', {
      channel,
      code: error && typeof error === 'object' && 'code' in error ? error.code : undefined,
    })
    return new Response(null, { status: 500 })
  }

  return new Response('EVENT_RECEIVED')
}
