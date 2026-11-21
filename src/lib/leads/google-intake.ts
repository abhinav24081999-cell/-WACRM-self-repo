import { supabaseAdmin } from '@/lib/flows/admin-client'
import { parseInternationalPhone } from '@/lib/whatsapp/phone-utils'

const clickFields = ['gclid', 'gbraid', 'wbraid'] as const
const utmFields = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const
const idFields = ['campaign_id', 'ad_group_id', 'ad_id'] as const

type InputRecord = Record<string, unknown>
type Answer = { name: string; values: string[] }
type Lead = {
  source: 'google_lead_form' | 'website_form'
  eventId: string
  name: string
  phone: string
  email: string
  adsPlatform: 'google' | null
  attribution: Record<string, string>
  answers: Answer[]
}

function record(value: unknown): InputRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as InputRecord : {}
}

function text(value: unknown, limit = 255): string {
  return typeof value === 'string' ? value.replaceAll('\0', '').trim().slice(0, limit).toWellFormed() : ''
}

function positiveId(value: unknown) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) value = String(value)
  return typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value) ? value : ''
}

function attribution(values: Record<string, string>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ''))
}

function contact(name: unknown, phone: unknown, email: unknown) {
  const phoneNumber = parseInternationalPhone(text(phone))
  const address = text(email).toLowerCase()
  return {
    name: text(name),
    phone: phoneNumber ? `+${phoneNumber}` : '',
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? address : '',
  }
}

export function parseLeadPayload(raw: string) {
  return record(JSON.parse(raw, (key, value, context?: { source: string }) => {
    // Google transmits numeric identifiers up to 64 bits.
    if (typeof value === 'number' && key.endsWith('_id')) return positiveId(context?.source ?? value)
    return value
  }))
}

export function googleFormLead(payload: InputRecord): Lead | null {
  const eventId = text(payload.lead_id, 513)
  if (!eventId || eventId.length > 512 || !Array.isArray(payload.user_column_data)) return null
  const answerMap = new Map<string, string[]>()
  for (const keyValue of payload.user_column_data as unknown[]) {
    const entry = record(keyValue)
    const column = text(entry.column_id, 120)
    const value = text(entry.string_value, 4096)
    if (column && value) answerMap.set(column, [...(answerMap.get(column) ?? []), value])
  }
  if (!answerMap.size && payload.is_test !== true) return null

  const first = (key: string) => answerMap.get(key)?.[0] ?? ''
  return {
    source: 'google_lead_form', eventId,
    ...contact(first('FULL_NAME') || [first('FIRST_NAME'), first('LAST_NAME')].filter(Boolean).join(' '),
      first('PHONE_NUMBER') || first('WORK_PHONE'), first('EMAIL') || first('WORK_EMAIL')),
    adsPlatform: 'google',
    attribution: attribution({
      form_id: positiveId(payload.form_id),
      campaign_id: positiveId(payload.campaign_id),
      ad_group_id: positiveId(payload.adgroup_id),
      ad_id: positiveId(payload.creative_id),
      gclid: text(payload.gcl_id, 512),
      gbraid: text(payload.gbraid, 512),
      wbraid: text(payload.wbraid, 512),
    }),
    answers: [...answerMap].map(([name, values]) => ({ name, values })),
  }
}

function pageUrl(value: unknown) {
  try {
    const url = new URL(text(value, 2048))
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return ''
    return `${url.origin}${url.pathname}`.slice(0, 2048)
  } catch {
    return ''
  }
}

export function websiteFormLead(payload: InputRecord): Lead | null {
  const eventId = text(payload.submission_id, 513)
  const details = contact(payload.name, payload.phone, payload.email)
  if (!eventId || eventId.length > 512 || (!details.phone && !details.email)) return null

  const input = record(payload.attribution)
  const tracking = attribution({
    ...Object.fromEntries(idFields.map(key => [key, positiveId(input[key])])),
    ...Object.fromEntries([...clickFields, ...utmFields].map(key => [key, text(input[key], 512)])),
    form_id: text(payload.form_id),
    landing_url: pageUrl(input.landing_url),
    referral_url: pageUrl(input.referral_url),
  })
  const paidGoogle = clickFields.some(key => tracking[key]) || (
    /^google$/i.test(tracking.utm_source ?? '') && /^(cpc|ppc|paidsearch|paid_search|paid)$/i.test(tracking.utm_medium ?? '')
  )
  const answers = Object.entries(record(payload.answers)).flatMap(([key, answer]) => {
    const name = text(key, 120)
    const values = (Array.isArray(answer) ? answer : [answer]).map(value => text(value, 4096)).filter(Boolean)
    return name && values.length ? [{ name, values }] : []
  })
  return {
    source: 'website_form', eventId, ...details,
    adsPlatform: paidGoogle ? 'google' : null, attribution: tracking, answers,
  }
}

export async function persistIntakeLead(workspaceId: string, lead: Lead) {
  const { error } = await supabaseAdmin().rpc('record_google_or_website_lead', {
    p_account_id: workspaceId,
    p_source: lead.source,
    p_event_id: lead.eventId,
    p_name: lead.name,
    p_phone: lead.phone,
    p_email: lead.email,
    p_ads_platform: lead.adsPlatform,
    p_attribution: lead.attribution,
    p_form_answers: lead.answers,
  })
  if (error) console.error('[lead-intake] database write failed', { source: lead.source, code: error.code })
  return !error
}
