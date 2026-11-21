import { sign } from 'node:crypto'

export type ConversionEvent = {
  id: string
  source: string
  destination: string
  test_mode: boolean
  event_time: string
  identifiers: Record<string, string>
  attempts: number
  attempt_limit: number
}

export class DeliveryError extends Error {
  constructor(readonly reason: string, readonly retryable = false) {
    super(reason)
  }
}

const metaRoutes: Record<string, string> = {
  meta_instant_form: 'CRM', whatsapp: 'WHATSAPP', instagram_dm: 'INSTAGRAM', messenger: 'MESSENGER',
}

export function feedbackWorkspace() {
  return process.env.CONVERSION_FEEDBACK_WORKSPACE_ID?.trim()
}

export function liveFeedbackEnabled() {
  return process.env.VERCEL_ENV !== 'preview' && process.env.CONVERSION_FEEDBACK_ALLOW_LIVE === 'true'
}

function numeric(value?: string) {
  return /^\d{1,40}$/.test(value ?? '') ? value : undefined
}

function metaConfig(source: string) {
  const route = metaRoutes[source]
  const dataset = numeric(process.env[`CONVERSION_META_${route}_DATASET_ID`]?.trim())
  const token = process.env[`CONVERSION_META_${route}_ACCESS_TOKEN`]?.trim()
  const businessAccount = numeric(process.env[`CONVERSION_META_${route}_ACCOUNT_ID`]?.trim())
  return { dataset, token, businessAccount }
}

function googleAccount() {
  return numeric(process.env.CONVERSION_GOOGLE_CUSTOMER_ID?.trim().replaceAll('-', ''))
}

export function configuredSources() {
  const ready = Object.keys(metaRoutes).filter(source => {
    const { dataset, token, businessAccount } = metaConfig(source)
    return Boolean(dataset && token && (source === 'meta_instant_form' || businessAccount))
  })
  if (googleAccount() && process.env.CONVERSION_GOOGLE_CLIENT_EMAIL && process.env.CONVERSION_GOOGLE_PRIVATE_KEY) {
    ready.push('google_lead_form', 'website_form')
  }
  return ready
}

export function metaEventPayload(event: ConversionEvent) {
  const base = { event_name: event.destination, event_id: event.id, event_time: Math.floor(Date.parse(event.event_time) / 1000) }
  if (event.source === 'meta_instant_form') return {
    ...base, action_source: 'system_generated', user_data: { lead_id: event.identifiers.lead_id },
    custom_data: { event_source: 'crm', lead_event_source: 'WACRM' },
  }
  const { account_id, sender_id, ctwa_clid, whatsapp_business_account_id } = event.identifiers
  const user_data = event.source === 'whatsapp' ? { whatsapp_business_account_id, ctwa_clid }
    : event.source === 'instagram_dm' ? { instagram_business_account_id: account_id, ig_sid: sender_id }
      : { page_id: account_id, page_scoped_user_id: sender_id }
  return {
    ...base, action_source: 'business_messaging', user_data,
    messaging_channel: event.source === 'instagram_dm' ? 'instagram' : event.source,
  }
}

export function googleEventPayload(event: ConversionEvent, customerId: string, managerId?: string) {
  const accountType = 'GOOGLE_ADS'
  return {
    destinations: [{
      operatingAccount: { accountType, accountId: customerId },
      ...(managerId && { loginAccount: { accountType, accountId: managerId } }),
      productDestinationId: event.destination,
    }],
    events: [{
      eventTimestamp: new Date(event.event_time).toISOString(),
      transactionId: event.id,
      eventSource: 'OTHER',
      adIdentifiers: event.identifiers,
    }],
    validateOnly: event.test_mode,
  }
}

function canRetry(status: number) {
  return status === 408 || status === 429 || status >= 500
}

async function post(url: string, headers: Record<string, string>, body: string) {
  try {
    const response = await fetch(url, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(8000) })
    return { status: response.status, ok: response.ok, data: await response.json().catch(() => null) }
  } catch {
    throw new DeliveryError('network_error', true)
  }
}

export async function googleAccessToken() {
  const issuer = process.env.CONVERSION_GOOGLE_CLIENT_EMAIL?.trim()
  const key = process.env.CONVERSION_GOOGLE_PRIVATE_KEY?.replaceAll('\\n', '\n').trim()
  if (!issuer || !key) throw new DeliveryError('google_credentials_missing')
  const url = 'https://oauth2.googleapis.com/token'
  const now = Math.floor(Date.now() / 1000)
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const jwt = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: issuer, scope: 'https://www.googleapis.com/auth/datamanager', aud: url, iat: now, exp: now + 3600,
  })}`
  let assertion: string
  try {
    assertion = `${jwt}.${sign('RSA-SHA256', Buffer.from(jwt), key).toString('base64url')}`
  } catch {
    throw new DeliveryError('google_key_invalid')
  }
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  const result = await post(url, { 'Content-Type': 'application/x-www-form-urlencoded' }, body.toString())
  if (!result.ok || typeof result.data?.access_token !== 'string') {
    throw new DeliveryError(`google_oauth_${result.status}`, canRetry(result.status))
  }
  return result.data.access_token as string
}

export async function sendConversion(event: ConversionEvent, googleToken: () => Promise<string>) {
  const headers = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })
  if (event.source === 'google_lead_form' || event.source === 'website_form') {
    const customerId = googleAccount()
    if (!customerId) throw new DeliveryError('google_customer_missing')
    const managerId = numeric(process.env.CONVERSION_GOOGLE_MANAGER_ID?.trim().replaceAll('-', ''))
    const body = googleEventPayload(event, customerId, managerId)
    const result = await post('https://datamanager.googleapis.com/v1/events:ingest', headers(await googleToken()), JSON.stringify(body))
    if (!result.ok || result.data?.error) throw new DeliveryError(`google_http_${result.status}`, canRetry(result.status))
    const requestId = result.data?.requestId
    if (!event.test_mode && typeof requestId !== 'string') throw new DeliveryError('google_response_missing_id', true)
    return typeof requestId === 'string' ? requestId.slice(0, 255) : null
  }

  const { dataset, token, businessAccount } = metaConfig(event.source)
  if (!dataset || !token) throw new DeliveryError('meta_destination_missing')
  if (event.source !== 'meta_instant_form' && (!businessAccount || businessAccount !==
    (event.source === 'whatsapp' ? event.identifiers.whatsapp_business_account_id : event.identifiers.account_id))) {
    throw new DeliveryError('meta_business_account_mismatch')
  }
  if (Date.now() - Date.parse(event.event_time) > 7 * 24 * 60 * 60 * 1000) throw new DeliveryError('meta_event_expired')
  const testCode = process.env[`CONVERSION_META_${metaRoutes[event.source]}_TEST_CODE`]?.trim()
  if (event.test_mode && !testCode) throw new DeliveryError('meta_test_code_missing')
  const payload = { data: [metaEventPayload(event)], ...(event.test_mode && { test_event_code: testCode }) }
  const result = await post(`https://graph.facebook.com/v27.0/${dataset}/events`, headers(token), JSON.stringify(payload))
  if (!result.ok || result.data?.error || result.data?.events_received !== 1) {
    const code = result.data?.error?.code
    throw new DeliveryError(Number.isInteger(code) ? `meta_error_${code}` : `meta_http_${result.status}`,
      canRetry(result.status) || result.data?.error?.is_transient === true || [4, 17, 32, 613].includes(code))
  }
  return typeof result.data.fbtrace_id === 'string' ? result.data.fbtrace_id.slice(0, 255) : null
}
