import { supabaseAdmin } from '@/lib/flows/admin-client'
import { workspaceFeatureAllowed } from '@/lib/auth/workspace-entitlements'
import { conversionTarget, DeliveryError, googleAccessToken, liveFeedbackEnabled, sendConversion, type ConversionEvent } from './providers'

export async function runConversionQueue(accountId: string) {
  const db = supabaseAdmin()
  if (!(await workspaceFeatureAllowed(db, accountId, 'capi'))) {
    return { processed: 0, accepted: 0, tested: 0, retrying: 0, failed: 0, needsReview: 0 }
  }
  const { data, error } = await db.rpc('claim_conversion_feedback', {
    p_account_id: accountId, p_allow_live: liveFeedbackEnabled(),
  })
  if (error) throw error
  let googleToken: Promise<string> | undefined
  const token = () => googleToken ??= googleAccessToken()
  const writes = await Promise.allSettled(((data ?? []) as ConversionEvent[]).map(async (event) => {
    let outcome: { state: string; reason: string | null; response_id: string | null; available_at?: string; http_status?: number; sent_at?: string }
    const target = event.provider_target ?? conversionTarget(event.source)
    if (target && !event.provider_target) {
      // Persist the destination before making a request that the provider might accept.
      const { data: pinned, error: pinError } = await db.from('conversion_feedback_events')
        .update({ provider_target: target }).eq('id', event.id).eq('account_id', accountId)
        .eq('state', 'sending').eq('attempts', event.attempts).select('id').maybeSingle()
      if (pinError || !pinned) throw new Error('Could not pin conversion destination')
    }
    try {
      const responseId = await sendConversion({ ...event, provider_target: target }, token)
      outcome = { state: event.test_mode ? 'tested' : 'accepted', reason: null, response_id: responseId,
        sent_at: new Date().toISOString() }
    } catch (failure) {
      const rejection = failure instanceof DeliveryError ? failure : new DeliveryError('internal_error', true)
      const retry = rejection.retryable && event.attempts < event.attempt_limit
      outcome = {
        state: rejection.uncertain ? 'needs_review' : retry ? 'retrying' : 'failed', reason: rejection.reason,
        response_id: rejection.receipt ?? null, ...(rejection.status && { http_status: rejection.status }),
        ...(retry && { available_at: new Date(Date.now() + 60_000 * 2 ** Math.min(5, event.attempts)).toISOString() }),
      }
    }

    const { error: writeError } = await db.from('conversion_feedback_events')
      .update({ ...outcome, lease_until: null })
      .eq('id', event.id).eq('account_id', accountId).eq('state', 'sending').eq('attempts', event.attempts)
    if (writeError) throw writeError
    return outcome.state
  }))
  if (writes.some(write => write.status === 'rejected')) throw new Error('Could not save conversion delivery outcomes')
  const results = writes.flatMap(write => write.status === 'fulfilled' ? [write.value] : [])
  return {
    processed: results.length,
    accepted: results.filter(state => state === 'accepted').length,
    tested: results.filter(state => state === 'tested').length,
    retrying: results.filter(state => state === 'retrying').length,
    failed: results.filter(state => state === 'failed').length,
    needsReview: results.filter(state => state === 'needs_review').length,
  }
}
