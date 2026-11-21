import { googleFormLead, parseLeadPayload, persistIntakeLead } from '@/lib/leads/google-intake'
import { readCappedBody } from '@/lib/whatsapp/webhook-body'
import { verifyTokenMatches } from '@/lib/whatsapp/webhook-signature'

export async function POST(request: Request) {
  const workspaceId = process.env.GOOGLE_LEAD_WORKSPACE_ID?.trim()
  const key = process.env.GOOGLE_LEAD_WEBHOOK_KEY?.trim()
  if (!workspaceId || !key) return new Response(null, { status: 503 })

  const raw = await readCappedBody(request, 64 * 1024)
  if (raw === null) return new Response(null, { status: 413 })
  let payload: ReturnType<typeof parseLeadPayload>
  try {
    payload = parseLeadPayload(raw)
  } catch {
    return new Response(null, { status: 400 })
  }
  if (typeof payload.google_key !== 'string' || !verifyTokenMatches(key, payload.google_key)) {
    return new Response(null, { status: 401 })
  }
  const lead = googleFormLead(payload)
  if (!lead || (payload.is_test !== undefined && typeof payload.is_test !== 'boolean')) {
    return new Response(null, { status: 400 })
  }
  if (payload.is_test === true) return Response.json({ status: 'test_received' })
  if (!await persistIntakeLead(workspaceId, lead)) return new Response(null, { status: 503 })
  return Response.json({ status: 'received' })
}
