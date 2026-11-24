import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { configuredSources, feedbackWorkspace, liveFeedbackEnabled, metaTestCode } from '@/lib/conversions/providers'
import { runConversionQueue } from '@/lib/conversions/worker'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { formConnection, formVerificationToken } from '@/lib/meta/lead-ads'
import { readCappedBody } from '@/lib/whatsapp/webhook-body'

export const maxDuration = 60
const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i

export async function GET() {
  try {
    const { accountId } = await requireRole('admin')
    const available = feedbackWorkspace() === accountId
    const sources = available ? configuredSources() : []
    return Response.json({
      available, sources, live: available && liveFeedbackEnabled(),
      metaTestSources: sources.filter(source => Boolean(metaTestCode(source))),
      metaIntake: {
        callbackConfigured: Boolean(formVerificationToken(accountId)),
        deliveryConfigured: formConnection()?.workspaceId === accountId,
      },
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin', 'capi')
    if (feedbackWorkspace() !== accountId) return Response.json({ error: 'workspace_not_configured' }, { status: 503 })
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      return new Response(null, { status: 415 })
    }
    const raw = await readCappedBody(request, 4096)
    if (raw === null) return new Response(null, { status: 413 })
    let body
    try { body = JSON.parse(raw) } catch { return new Response(null, { status: 400 }) }
    if (body?.action === 'run') return Response.json(await runConversionQueue(accountId))
    if (body?.action === 'save') {
      const { source, stage, destination, delivery, test_mode } = body.rule ?? {}
      if (typeof source !== 'string' || !['new', 'qualified', 'converted'].includes(stage) ||
        typeof destination !== 'string' || !/^[a-z\d_ ]{1,80}$/i.test(destination) ||
        !['manual', 'automatic', 'off'].includes(delivery) || typeof test_mode !== 'boolean') {
        return new Response(null, { status: 400 })
      }
      const { data, error } = await supabaseAdmin().rpc('save_conversion_feedback_rule', {
        p_account_id: accountId, p_source: source, p_stage: stage, p_destination: destination,
        p_delivery: delivery, p_test_mode: test_mode, p_allow_live: liveFeedbackEnabled(),
      })
      if (error) return new Response(null, { status: error.code === '23514' ? 400 : 503 })
      return new Response(null, { status: data ? 204 : 409 })
    }
    if (body?.action === 'retry' && typeof body.eventId === 'string' && uuid.test(body.eventId)) {
      const { data, error } = await supabaseAdmin().rpc('retry_conversion_feedback', {
        p_account_id: accountId, p_event_id: body.eventId, p_allow_live: liveFeedbackEnabled(),
      })
      if (error) return new Response(null, { status: 503 })
      if (!data) return new Response(null, { status: 409 })
      return Response.json({ eventId: body.eventId })
    }
    if (body?.action !== 'queue' || typeof body.leadId !== 'string' ||
      !uuid.test(body.leadId) ||
      !['new', 'qualified', 'converted'].includes(body.stage)) return new Response(null, { status: 400 })

    if (body.stage === 'new' && body.confirmedSubmission !== true) {
      const { data: lead, error } = await supabaseAdmin().from('leads').select('source')
        .eq('id', body.leadId).eq('account_id', accountId).maybeSingle()
      if (error) return new Response(null, { status: 503 })
      if (lead && ['whatsapp', 'instagram_dm', 'messenger'].includes(lead.source)) {
        return Response.json({ error: 'confirm_messaging_submission' }, { status: 422 })
      }
    }

    const { data, error } = await supabaseAdmin().rpc('request_conversion_feedback', {
      p_account_id: accountId, p_lead_id: body.leadId, p_stage: body.stage,
      p_allow_live: liveFeedbackEnabled(),
    })
    if (error) return new Response(null, { status: 503 })
    if (!data) return Response.json({ error: 'no_configured_milestone' }, { status: 422 })
    return Response.json({ eventId: data })
  } catch (error) {
    return toErrorResponse(error)
  }
}
