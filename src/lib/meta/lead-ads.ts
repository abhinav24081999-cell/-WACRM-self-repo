import { enrichAd, fields, metaId, metaText, readGraphObject } from '../../../supabase/functions/_shared/meta-ad-attribution'
import { parseInternationalPhone } from '@/lib/whatsapp/phone-utils'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export function adsTokenFor(workspaceId: string) {
  return workspaceId === process.env.META_LEAD_WORKSPACE_ID?.trim()
    ? process.env.META_LEAD_ADS_ACCESS_TOKEN?.trim() || undefined
    : undefined
}

export function formConnection() {
  const workspaceId = process.env.META_LEAD_WORKSPACE_ID?.trim()
  const pageId = metaId(process.env.META_LEAD_PAGE_ID?.trim())
  const accessToken = process.env.META_LEAD_PAGE_ACCESS_TOKEN?.trim()
  const appSecret = process.env.META_LEAD_APP_SECRET?.trim()
  const verifyToken = process.env.META_LEAD_VERIFY_TOKEN?.trim()
  if (!workspaceId || !pageId || !accessToken || !appSecret || !verifyToken) return null
  return { workspaceId, pageId, accessToken, appSecret, verifyToken }
}

export function readFormEvents(raw: string, pageId: string) {
  // Meta can encode IDs as JSON numbers. Keep their original decimal digits.
  const payload = JSON.parse(raw, (key, value, context?: { source: string }) =>
    typeof value === 'number' && (key === 'id' || key.endsWith('_id'))
      ? metaId(context?.source ?? value)
      : value,
  )
  const events = new Map<string, Record<string, string>>()
  if (payload?.object !== 'page' || !Array.isArray(payload.entry)) return events
  for (const entry of payload.entry) {
    if (metaId(entry?.id) !== pageId || !Array.isArray(entry.changes)) continue
    for (const change of entry.changes) {
      const value = change?.value
      if (change?.field !== 'leadgen' || metaId(value?.page_id) !== pageId) continue
      const id = metaId(value.leadgen_id)
      if (!id) continue
      events.set(id, fields({
        external_lead_id: id,
        meta_page_id: pageId,
        form_id: metaId(value.form_id),
        ad_id: metaId(value.ad_id),
        ad_group_id: metaId(value.adgroup_id),
      }))
    }
  }
  return events
}

export async function retrieveFormLead(id: string, token: string) {
  let lead
  try {
    lead = await readGraphObject(id, 'id,field_data,platform,form_id,ad_id,adset_id,campaign_id', token, 5000)
  } catch (error) {
    if (!(error instanceof Error) || (error.cause !== 400 && error.cause !== 403)) throw error
    lead = await readGraphObject(id, 'id,field_data,form_id', token, 5000)
  }
  if (metaId(lead?.id) !== id || !Array.isArray(lead.field_data)) throw new Error('Invalid Meta lead response')
  const answers = new Map<string, string>()
  for (const answer of lead.field_data) {
    if (typeof answer?.name !== 'string' || !Array.isArray(answer.values)) continue
    answers.set(answer.name, metaText(answer.values[0]))
  }

  const rawPhone = answers.get('phone_number') ?? ''
  const phone = parseInternationalPhone(rawPhone)
  const email = answers.get('email') ?? ''
  return {
    name: answers.get('full_name') || [answers.get('first_name'), answers.get('last_name')].filter(Boolean).join(' ').slice(0, 255),
    phone: phone ? `+${phone}` : '',
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase() : '',
    attribution: fields({
      meta_platform: metaText(lead.platform),
      form_id: metaId(lead.form_id),
      ad_id: metaId(lead.ad_id),
      ad_group_id: metaId(lead.adset_id),
      campaign_id: metaId(lead.campaign_id),
    }),
  }
}

export async function captureFormLeads(
  events: ReturnType<typeof readFormEvents>,
  connection: NonNullable<ReturnType<typeof formConnection>>,
) {
  const db = supabaseAdmin()
  let failed = false
  for (const [id, webhookAttribution] of events) {
    try {
      const existing = await db.from('leads').select('id')
        .eq('account_id', connection.workspaceId).eq('meta_event_key', `meta_instant_form:${id}`).maybeSingle()
      if (existing.error) throw existing.error
      if (existing.data) continue

      const lead = await retrieveFormLead(id, connection.accessToken)
      const attribution = await enrichAd(
        { ...webhookAttribution, ...lead.attribution },
        adsTokenFor(connection.workspaceId) ?? connection.accessToken,
      )
      const { error } = await db.rpc('record_meta_form_lead', {
        p_account_id: connection.workspaceId,
        p_lead_id: id,
        p_name: lead.name,
        p_phone: lead.phone,
        p_email: lead.email,
        p_attribution: attribution,
      })
      if (error) throw error
    } catch (error) {
      failed = true
      console.error('[meta-leads] Could not import form submission', error instanceof Error ? error.name : 'Database error')
    }
  }
  return !failed
}
