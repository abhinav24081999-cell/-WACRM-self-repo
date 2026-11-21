import { reportSpend, type AdLevel, type AdPlatform } from '@/lib/ads-performance'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

export const maxDuration = 60

const levels = ['campaign', 'ad_group', 'ad'] as const
const platforms = ['all', 'meta', 'google'] as const
const sources = ['manual', 'whatsapp', 'instagram_dm', 'messenger', 'meta_instant_form', 'google_lead_form', 'website_form', 'other']
const statuses = ['new', 'interested', 'not_interested', 'busy', 'no_response', 'in_process', 'qualified', 'converted', 'completed', 'junk']

function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : NaN
}

export async function GET(request: Request) {
  try {
    const { accountId, supabase } = await requireRole('admin')
    const params = new URL(request.url).searchParams
    const from = params.get('from') ?? ''
    const to = params.get('to') ?? ''
    const platform = (params.get('platform') ?? 'all') as typeof platforms[number]
    const level = (params.get('level') ?? 'campaign') as AdLevel
    const source = params.get('source') || null
    const status = params.get('status') || null
    const tag = params.get('tag') || null
    const days = (date(to) - date(from)) / 86_400_000
    if (!(days >= 0 && days <= 90) || !platforms.includes(platform) || !levels.includes(level) ||
      (source && !sources.includes(source)) || (status && !statuses.includes(status)) ||
      (tag && !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(tag))) {
      return Response.json({ error: 'Check the filters and choose a range of up to 91 days.' }, { status: 400 })
    }

    const { data, error } = await supabase.rpc('ads_performance_rollup', {
      p_account_id: accountId, p_from: from, p_to: to, p_platform: platform, p_level: level,
      p_source: source, p_status: status, p_tag: tag,
    })
    if (error) return Response.json({ error: 'Unable to load the CRM report.' }, { status: 503 })

    const selected: AdPlatform[] = platform === 'all' ? ['meta', 'google'] : [platform]
    const feeds = await Promise.all(selected.map(async (provider) => {
      const feed = source || status || tag ? { state: 'filtered', rows: [] }
        : process.env.ADS_REPORTING_WORKSPACE_ID !== accountId ? { state: 'not_configured', rows: [] }
        : await reportSpend(provider, level, from, to)
      return [provider, feed] as const
    }))
    return Response.json({ ...data, spend: Object.fromEntries(feeds) }, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
