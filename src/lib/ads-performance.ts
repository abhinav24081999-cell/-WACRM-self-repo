import { googleAccessToken } from '@/lib/conversions/providers'

export type AdPlatform = 'meta' | 'google'
export type AdLevel = 'campaign' | 'ad_group' | 'ad'
export type CostRow = { entity_id: string; name?: string; campaign_id?: string; ad_group_id?: string; spend: number; currency: string }
type Feed = { state: 'ready' | 'not_configured' | 'unavailable' | 'timezone_mismatch'; rows: CostRow[] }

async function fetchJson(url: URL, headers: Record<string, string>, body?: object) {
  const response = await fetch(url, {
    headers, method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error('Ads reporting request failed')
  return response.json()
}

function indiaZone(value: unknown) {
  return value === 'Asia/Kolkata' || value === 'Asia/Calcutta'
}

function addCost(rows: Map<string, CostRow>, row: CostRow) {
  if (!row.entity_id || !Number.isFinite(row.spend) || row.spend < 0 || !/^[A-Z]{3}$/.test(row.currency)) {
    throw new Error('Malformed spend row')
  }
  const existing = rows.get(row.entity_id)
  rows.set(row.entity_id, existing ? { ...existing, spend: existing.spend + row.spend } : row)
}

async function metaCosts(level: AdLevel, from: string, to: string): Promise<Feed> {
  const id = process.env.ADS_REPORTING_META_ACCOUNT_ID?.trim().replace(/^act_/, '')
  const token = process.env.ADS_REPORTING_META_TOKEN?.trim()
  if (!id || !/^\d{1,40}$/.test(id) || !token) return { state: 'not_configured', rows: [] }

  const root = `https://graph.facebook.com/v27.0/act_${id}`
  const headers = { Authorization: `Bearer ${token}` }
  const account = await fetchJson(new URL(`${root}?fields=timezone_name,currency`), headers)
  if (!indiaZone(account.timezone_name)) return { state: 'timezone_mismatch', rows: [] }
  const entity = level === 'ad_group' ? 'adset' : level
  const url = new URL(`${root}/insights`)
  url.searchParams.set('level', entity)
  url.searchParams.set('fields', [...new Set(['spend', `${entity}_id`, `${entity}_name`, 'campaign_id', ...(entity === 'ad' ? ['adset_id'] : [])])].join(','))
  url.searchParams.set('time_range', JSON.stringify({ since: from, until: to }))
  url.searchParams.set('limit', '500')

  const rows = new Map<string, CostRow>()
  for (let page = 0; page < 10; page++) {
    const result = await fetchJson(url, headers)
    if (!Array.isArray(result.data)) throw new Error('Malformed report')
    for (const row of result.data) addCost(rows, {
      entity_id: row[`${entity}_id`], name: row[`${entity}_name`],
      campaign_id: row.campaign_id, ad_group_id: row.adset_id, spend: Number(row.spend), currency: account.currency,
    })
    if (!result.paging?.next) return { state: 'ready', rows: [...rows.values()] }
    const cursor = result.paging.cursors?.after
    if (typeof cursor !== 'string') break
    url.searchParams.set('after', cursor)
  }
  throw new Error('Ads report pagination limit reached')
}

async function googleCosts(level: AdLevel, from: string, to: string): Promise<Feed> {
  const id = process.env.ADS_REPORTING_GOOGLE_CUSTOMER_ID?.replaceAll('-', '').trim()
  const issuer = process.env.ADS_REPORTING_GOOGLE_CLIENT_EMAIL?.trim()
  const key = process.env.ADS_REPORTING_GOOGLE_PRIVATE_KEY?.replaceAll('\\n', '\n').trim()
  if (!id || !/^\d{10}$/.test(id) || !issuer || !key) return { state: 'not_configured', rows: [] }
  const token = await googleAccessToken('https://www.googleapis.com/auth/adwords', issuer, key)
  const manager = process.env.ADS_REPORTING_GOOGLE_MANAGER_ID?.replaceAll('-', '').trim()
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
    ...(manager && /^\d{10}$/.test(manager) && { 'login-customer-id': manager }) }
  const url = new URL(`https://googleads.googleapis.com/v26/customers/${id}/googleAds:searchStream`)
  const account = await fetchJson(url, headers, { query: 'SELECT customer.time_zone, customer.currency_code FROM customer LIMIT 1' })
  const customer = account[0]?.results?.[0]?.customer
  if (!indiaZone(customer?.timeZone)) return { state: 'timezone_mismatch', rows: [] }
  const entity = level === 'ad' ? 'ad_group_ad' : level
  const fields = level === 'ad' ? 'ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group.id, campaign.id'
    : level === 'ad_group' ? 'ad_group.id, ad_group.name, campaign.id' : 'campaign.id, campaign.name'
  const result = await fetchJson(url, headers, {
    query: `SELECT ${fields}, metrics.cost_micros FROM ${entity} WHERE segments.date BETWEEN '${from}' AND '${to}'`,
  })
  if (!Array.isArray(result)) throw new Error('Malformed report')
  const rows = new Map<string, CostRow>()
  for (const chunk of result) for (const row of chunk.results ?? []) {
    const item = level === 'ad' ? row.adGroupAd?.ad : level === 'ad_group' ? row.adGroup : row.campaign
    addCost(rows, { entity_id: item?.id, name: item?.name, campaign_id: row.campaign?.id, ad_group_id: row.adGroup?.id,
      spend: Number(row.metrics?.costMicros ?? 0) / 1_000_000, currency: customer.currencyCode })
  }
  return { state: 'ready', rows: [...rows.values()] }
}

export async function reportSpend(platform: AdPlatform, level: AdLevel, from: string, to: string): Promise<Feed> {
  try {
    return await (platform === 'meta' ? metaCosts(level, from, to) : googleCosts(level, from, to))
  } catch {
    return { state: 'unavailable', rows: [] }
  }
}
