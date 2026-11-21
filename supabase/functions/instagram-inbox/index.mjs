import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { readMessages } from '../_shared/social-webhook.ts'
import config from './config.json' with { type: 'json' }

const maxBodyBytes = 256 * 1024

Deno.serve(async (request) => {
  const secret = Deno.env.get('WACRM_INSTAGRAM_APP_SECRET')?.trim()
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!secret || !supabaseUrl || !serviceKey || !config.accountId ||
      !config.accountLabel || !config.workspaceId || !/^[0-9a-f]{64}$/.test(config.verifyTokenHash ?? '')) {
    return new Response(null, { status: 503 })
  }

  if (request.method === 'GET') {
    const query = new URL(request.url).searchParams
    const challenge = query.get('hub.challenge')
    const token = query.get('hub.verify_token') ?? ''
    const supplied = createHash('sha256').update(token).digest()
    const expected = Buffer.from(config.verifyTokenHash, 'hex')
    if (query.get('hub.mode') !== 'subscribe' || !challenge || !timingSafeEqual(supplied, expected)) {
      return new Response(null, { status: 403 })
    }
    return new Response(challenge)
  }

  if (request.method !== 'POST') return new Response(null, { status: 405 })
  const signature = request.headers.get('x-hub-signature-256') ?? ''
  if (!/^sha256=[0-9a-f]{64}$/.test(signature)) return new Response(null, { status: 401 })
  if (Number(request.headers.get('content-length')) > maxBodyBytes) {
    return new Response(null, { status: 413 })
  }

  const raw = Buffer.from(await request.arrayBuffer())
  if (raw.length > maxBodyBytes) return new Response(null, { status: 413 })
  const digest = createHmac('sha256', secret).update(raw).digest()
  if (!timingSafeEqual(Buffer.from(signature.slice(7), 'hex'), digest)) {
    return new Response(null, { status: 401 })
  }

  let payload
  try {
    payload = JSON.parse(raw.toString('utf8'))
  } catch {
    return new Response(null, { status: 400 })
  }
  try {
    for (const message of readMessages(payload, 'instagram', config.accountId)) {
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/record_social_message`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_account_id: config.workspaceId,
          p_channel: 'instagram',
          p_channel_account_id: config.accountId,
          p_channel_account_label: config.accountLabel,
          p_sender_id: message.senderId,
          p_message_id: message.messageId,
          p_text: message.text,
          p_sent_at: message.sentAt,
          p_outgoing: message.outgoing,
          p_agent_id: null,
        }),
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) throw new Error(`RPC status ${response.status}`)
    }
  } catch (error) {
    console.error('[instagram-inbox] Could not persist Meta delivery', error instanceof Error ? error.name : 'Unknown')
    return new Response(null, { status: 503 })
  }
  return new Response('EVENT_RECEIVED')
})
