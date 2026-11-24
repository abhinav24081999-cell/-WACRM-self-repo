import { captureFormLeads, formConnection, formVerificationToken, readFormEvents } from '@/lib/meta/lead-ads'
import { validSignature } from '@/lib/social/meta'
import { readCappedBody } from '@/lib/whatsapp/webhook-body'
import { verifyTokenMatches } from '@/lib/whatsapp/webhook-signature'

export const maxDuration = 60

export function GET(request: Request) {
  const verifyToken = formVerificationToken()
  const query = new URL(request.url).searchParams
  const token = query.get('hub.verify_token')
  const challenge = query.get('hub.challenge')
  if (!verifyToken || !token || !challenge || query.get('hub.mode') !== 'subscribe' ||
      !verifyTokenMatches(verifyToken, token)) return new Response(null, { status: 403 })
  return new Response(challenge)
}

export async function POST(request: Request) {
  const connection = formConnection()
  if (!connection) return new Response(null, { status: 503 })
  const raw = await readCappedBody(request)
  if (raw === null) return new Response(null, { status: 413 })
  if (!validSignature(raw, request.headers.get('x-hub-signature-256'), connection.appSecret)) {
    return new Response(null, { status: 401 })
  }
  let events: ReturnType<typeof readFormEvents>
  try {
    events = readFormEvents(raw, connection.pageId)
  } catch {
    return new Response(null, { status: 400 })
  }
  if (events.size && !await captureFormLeads(events, connection)) return new Response(null, { status: 503 })
  return new Response('EVENT_RECEIVED')
}
