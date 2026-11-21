import { verifyTokenMatches } from '@/lib/whatsapp/webhook-signature'
import { feedbackWorkspace } from '@/lib/conversions/providers'
import { runConversionQueue } from '@/lib/conversions/worker'

export const maxDuration = 60

export async function GET(request: Request) {
  const workspace = feedbackWorkspace()
  const bearer = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1]
  const legacy = request.headers.get('x-cron-secret')
  const cronSecret = process.env.CRON_SECRET
  const automationSecret = process.env.AUTOMATION_CRON_SECRET
  if (!cronSecret && !automationSecret) return new Response(null, { status: 503 })
  const matches = (cronSecret && bearer && verifyTokenMatches(cronSecret, bearer)) ||
    (automationSecret && legacy && verifyTokenMatches(automationSecret, legacy))
  if (!matches) return new Response(null, { status: 401 })
  if (!workspace) return new Response(null, { status: 204 })
  try {
    const totals = { processed: 0, accepted: 0, tested: 0, retrying: 0, failed: 0, needsReview: 0 }
    const deadline = Date.now() + 35_000
    for (let batch = 0; batch < 20 && Date.now() < deadline; batch++) {
      const result = await runConversionQueue(workspace)
      if (!result.processed) break
      for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += result[key]
    }
    return Response.json(totals)
  } catch {
    return new Response(null, { status: 503 })
  }
}
