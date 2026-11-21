import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { backfillFormLeads, formConnection } from '@/lib/meta/lead-ads'
import { readCappedBody } from '@/lib/whatsapp/webhook-body'

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const connection = formConnection()
    if (!connection || connection.workspaceId !== accountId) {
      return Response.json({ error: 'Connect the Meta lead form Page for this workspace first.' }, { status: 503 })
    }
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      return new Response(null, { status: 415 })
    }
    const raw = await readCappedBody(request, 4096)
    if (raw === null) return new Response(null, { status: 413 })
    let body
    try { body = JSON.parse(raw) } catch { return new Response(null, { status: 400 }) }
    if (typeof body?.formId !== 'string' || !/^\d{1,40}$/.test(body.formId) ||
      (body.after !== undefined && (typeof body.after !== 'string' || body.after.length > 2048))) {
      return Response.json({ error: 'Enter a valid Meta Instant Form ID.' }, { status: 400 })
    }
    try {
      const result = await backfillFormLeads(connection, body.formId, body.after)
      if (!result) return Response.json({ error: 'This form was unavailable on the connected Page.' }, { status: 404 })
      return Response.json(result)
    } catch {
      return Response.json({ error: 'Could not read this form from Meta. Check Page and Leads Access permissions.' }, { status: 502 })
    }
  } catch (error) {
    return toErrorResponse(error)
  }
}
