import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'
import { connectionFor, fetchContactName } from '@/lib/social/meta'

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const limit = checkRateLimit(`instagram-username:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const id = body?.conversation_id
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) {
      return new Response(null, { status: 400 })
    }

    const connection = connectionFor('instagram')
    if (!connection || connection.workspaceId !== accountId) {
      return new Response(null, { status: 404 })
    }

    const { data: thread, error: threadError } = await supabase.from('conversations')
      .select('contact_id, channel_sender_id')
      .eq('id', id)
      .eq('account_id', accountId)
      .eq('channel', 'instagram')
      .eq('channel_account_id', connection.accountId)
      .maybeSingle()
    if (threadError) throw threadError
    if (!thread?.channel_sender_id) return new Response(null, { status: 404 })

    const { data: contact, error: contactError } = await supabase.from('contacts')
      .select('id, name').eq('id', thread.contact_id).eq('account_id', accountId).maybeSingle()
    if (contactError) throw contactError
    if (!contact) return new Response(null, { status: 404 })
    if (contact.name?.trim()) return Response.json({ contact_id: contact.id, name: contact.name })

    const { data: message, error: messageError } = await supabase.from('messages')
      .select('message_id').eq('conversation_id', id).eq('sender_type', 'customer')
      .like('message_id', 'instagram:%').order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (messageError) throw messageError

    const messageId = message?.message_id?.slice('instagram:'.length)
    const name = await fetchContactName('instagram', connection.accessToken, thread.channel_sender_id, messageId)
    if (!name) return new Response(null, { status: 204 })

    const update = supabase.from('contacts').update({ name }).eq('id', contact.id).eq('account_id', accountId)
    const { data: saved, error: saveError } = await (contact.name === null
      ? update.is('name', null)
      : update.eq('name', contact.name)).select('id, name').maybeSingle()
    if (saveError) throw saveError
    return saved ? Response.json({ contact_id: saved.id, name: saved.name }) : new Response(null, { status: 204 })
  } catch (error) {
    return toErrorResponse(error)
  }
}
