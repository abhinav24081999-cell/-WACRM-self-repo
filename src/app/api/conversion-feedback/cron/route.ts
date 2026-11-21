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
  if (!workspace || (!cronSecret && !automationSecret)) return new Response(null, { status: 503 })
  const matches = (cronSecret && bearer && verifyTokenMatches(cronSecret, bearer)) ||
    (automationSecret && legacy && verifyTokenMatches(automationSecret, legacy))
  if (!matches) return new Response(null, { status: 401 })
  try {
    return Response.json(await runConversionQueue(workspace))
  } catch {
    return new Response(null, { status: 503 })
  }
}
