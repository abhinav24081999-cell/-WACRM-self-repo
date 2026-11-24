import { enrichAd, fields, metaId, metaText, readGraphObject } from '../../../supabase/functions/_shared/meta-ad-attribution'
import { parseInternationalPhone } from '@/lib/whatsapp/phone-utils'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export function metaLeadWorkspace() {
  return process.env.META_LEAD_WORKSPACE_ID?.trim()
}

export function adsTokenFor(workspaceId: string) {
  return workspaceId === metaLeadWorkspace()
    ? process.env.META_LEAD_ADS_ACCESS_TOKEN?.trim() || undefined
    : undefined
}

function formTarget() {
  const workspaceId = metaLeadWorkspace()
  const pageId = metaId(process.env.META_LEAD_PAGE_ID?.trim())
  return workspaceId && pageId ? { workspaceId, pageId } : null
}

export function formVerificationToken(accountId?: string) {
  const target = formTarget()
  if (!target || (accountId && target.workspaceId !== accountId)) return undefined
  return process.env.META_LEAD_VERIFY_TOKEN?.trim() || undefined
}

export function formConnection() {
  const target = formTarget()
  const accessToken = process.env.META_LEAD_PAGE_ACCESS_TOKEN?.trim()
  const appSecret = process.env.META_LEAD_APP_SECRET?.trim()
  if (!target || !accessToken || !appSecret) return null
  return { ...target, accessToken, appSecret }
}

function providerTime(value: unknown) {
  const millis = typeof value === 'number' ? value * 1000 : Date.parse(metaText(value))
  return Number.isFinite(millis) && millis > 0 && millis <= Date.now() + 60_000 ? new Date(millis).toISOString() : ''
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
        provider_created_at: providerTime(value.created_time),
      }))
    }
  }
  return events
}

const leadFields = 'id,field_data,platform,form_id,ad_id,adset_id,campaign_id,created_time'

export async function retrieveFormLead(id: string, token: string) {
  let lead
  try {
    lead = await readGraphObject(id, leadFields, token, 5000)
  } catch (error) {
    if (!(error instanceof Error) || (error.cause !== 400 && error.cause !== 403)) throw error
    lead = await readGraphObject(id, 'id,field_data,form_id,created_time', token, 5000)
  }
  return normalizeFormLead(lead, id)
}

function normalizeFormLead(lead: Awaited<ReturnType<typeof readGraphObject>>, id: string) {
  if (metaId(lead?.id) !== id || !Array.isArray(lead.field_data)) throw new Error('Invalid Meta lead response')
  const answers = new Map<string, string[]>()
  for (const answer of lead.field_data) {
    if (typeof answer?.name !== 'string' || !Array.isArray(answer.values)) continue
    const name = metaText(answer.name)
    const values = (answer.values as unknown[]).map(value => metaText(value, 4096)).filter(Boolean)
    if (name && values.length) answers.set(name, [...(answers.get(name) ?? []), ...values])
  }

  const first = (key: string) => metaText(answers.get(key)?.[0])
  const phone = parseInternationalPhone(first('phone_number'))
  const email = first('email')
  return {
    name: first('full_name') || metaText([first('first_name'), first('last_name')].filter(Boolean).join(' ')),
    phone: phone ? `+${phone}` : '',
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase() : '',
    formAnswers: [...answers].map(([name, values]) => ({ name, values })),
    attribution: fields({
      meta_platform: metaText(lead.platform),
      form_id: metaId(lead.form_id),
      ad_id: metaId(lead.ad_id),
      ad_group_id: metaId(lead.adset_id),
      campaign_id: metaId(lead.campaign_id),
      provider_created_at: providerTime(lead.created_time),
    }),
  }
}

type FormConnection = NonNullable<ReturnType<typeof formConnection>>

async function storeFormLead(id: string, attribution: Record<string, string>, connection: FormConnection,
  provided?: ReturnType<typeof normalizeFormLead>) {
  const db = supabaseAdmin()
  const existing = await db.from('leads').select('id')
    .eq('account_id', connection.workspaceId).eq('meta_event_key', `meta_instant_form:${id}`).maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data) return false

  const lead = provided ?? await retrieveFormLead(id, connection.accessToken)
  const details = { ...attribution, ...lead.attribution }
  const { error } = await db.rpc('record_meta_form_lead', {
    p_account_id: connection.workspaceId,
    p_lead_id: id,
    p_name: lead.name,
    p_phone: lead.phone,
    p_email: lead.email,
    p_attribution: provided ? details : await enrichAd(details, adsTokenFor(connection.workspaceId) ?? connection.accessToken),
    p_form_answers: lead.formAnswers,
  })
  if (error) throw error
  return true
}

export async function captureFormLeads(events: ReturnType<typeof readFormEvents>, connection: FormConnection) {
  let failed = false
  for (const [id, attribution] of events) {
    try {
      await storeFormLead(id, attribution, connection)
    } catch {
      failed = true
      console.error('[meta-leads] Could not import form submission')
    }
  }
  return !failed
}

export async function backfillFormLeads(connection: FormConnection, formId: string, after?: string) {
  const { pageId, accessToken } = connection
  let cursor = ''
  let owned = false
  // Only read forms returned by the Page pinned to this workspace.
  for (let page = 0; page < 5; page++) {
    const listed = await readGraphObject(`${pageId}/leadgen_forms`, 'id', accessToken, 5000,
      { limit: '100', ...(cursor && { after: cursor }) })
    if (!Array.isArray(listed.data)) throw new Error('Invalid Meta form list')
    if (listed.data.some((form: { id?: unknown }) => metaId(form.id) === formId)) {
      owned = true
      break
    }
    cursor = listed.paging?.next ? metaText(listed.paging.cursors?.after, 2048) : ''
    if (!cursor) break
  }
  if (!owned) return null
  const details = await readGraphObject(`${formId}/leads`, leadFields, accessToken, 5000,
    { limit: '20', ...(after && { after }) })
  if (!Array.isArray(details.data)) throw new Error('Invalid Meta lead list')
  const rows = details.data.slice(0, 20)
  const results = await Promise.allSettled(rows.map(async (lead: Awaited<ReturnType<typeof readGraphObject>>) => {
    const id = metaId(lead?.id)
    if (!id || (lead.form_id && metaId(lead.form_id) !== formId)) throw new Error('Invalid Meta form lead')
    return storeFormLead(id, { form_id: formId, meta_page_id: pageId }, connection, normalizeFormLead(lead, id))
  }))
  const failed = results.filter(result => result.status === 'rejected').length
  const imported = results.filter(result => result.status === 'fulfilled' && result.value).length
  const next = !failed && details.paging?.next ? metaText(details.paging.cursors?.after, 2048) || null : null
  return { scanned: rows.length, imported, existing: rows.length - failed - imported, failed, next }
}
