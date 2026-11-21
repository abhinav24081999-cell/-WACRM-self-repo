import { parseLeadPayload, persistIntakeLead, websiteFormLead } from '@/lib/leads/google-intake'
import { readCappedBody } from '@/lib/whatsapp/webhook-body'
import { verifyTokenMatches } from '@/lib/whatsapp/webhook-signature'

export async function POST(request: Request) {
  const workspaceId = process.env.GOOGLE_LEAD_WORKSPACE_ID?.trim()
  const key = process.env.WEBSITE_LEAD_WEBHOOK_KEY?.trim()
  if (!workspaceId || !key) return new Response(null, { status: 503 })

  const supplied = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1]
  if (!supplied || !verifyTokenMatches(key, supplied)) return new Response(null, { status: 401 })
  const raw = await readCappedBody(request, 64 * 1024)
  if (raw === null) return new Response(null, { status: 413 })

  let lead: ReturnType<typeof websiteFormLead>
  try {
    lead = websiteFormLead(parseLeadPayload(raw))
  } catch {
    return new Response(null, { status: 400 })
  }
  if (!lead) return new Response(null, { status: 400 })
  if (!await persistIntakeLead(workspaceId, lead)) return new Response(null, { status: 503 })
  return Response.json({ status: 'received' })
}
