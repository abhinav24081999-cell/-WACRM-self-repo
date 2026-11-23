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
  provider_target?: string | null
}

export class DeliveryError extends Error {
  constructor(readonly reason: string, readonly retryable = false, readonly uncertain = false,
    readonly status?: number, readonly receipt?: string) {
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

export function isMessagingConversion(source: string) {
  return source === 'whatsapp' || source === 'instagram_dm' || source === 'messenger'
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

export function metaTestCode(source: string) {
  const route = metaRoutes[source]
  return route ? process.env[`CONVERSION_META_${route}_TEST_CODE`]?.trim() : undefined
}

function googleAccount() {
  return numeric(process.env.CONVERSION_GOOGLE_CUSTOMER_ID?.trim().replaceAll('-', ''))
}

export function conversionTarget(source: string) {
  return source === 'google_lead_form' || source === 'website_form' ? googleAccount() : metaConfig(source).dataset
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
  const occurredAt = Date.parse(event.event_time)
  const createdAt = Date.parse(event.identifiers.provider_created_at)
  const eventSecond = Math.floor(occurredAt / 1000)
  // Preserve ordering when a real CRM transition and the source lead share a Unix second.
  const event_time = event.source === 'meta_instant_form' && occurredAt > createdAt
    ? Math.max(eventSecond, Math.floor(createdAt / 1000) + 1)
    : eventSecond
  const base = { event_name: event.destination, event_id: event.id, event_time }
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

export async function googleAccessToken(scope = 'https://www.googleapis.com/auth/datamanager',
  issuer = process.env.CONVERSION_GOOGLE_CLIENT_EMAIL?.trim(),
  key = process.env.CONVERSION_GOOGLE_PRIVATE_KEY?.replaceAll('\\n', '\n').trim()) {
  if (!issuer || !key) throw new DeliveryError('google_credentials_missing')
  const url = 'https://oauth2.googleapis.com/token'
  const now = Math.floor(Date.now() / 1000)
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const jwt = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: issuer, scope, aud: url, iat: now, exp: now + 3600,
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
  if (event.provider_target && event.provider_target !== conversionTarget(event.source)) {
    throw new DeliveryError('provider_destination_changed')
  }
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
  const occurredAt = Date.parse(event.event_time)
  const createdAt = Date.parse(event.identifiers.provider_created_at)
  if (!Number.isFinite(occurredAt) || occurredAt > Date.now()) throw new DeliveryError('meta_event_time_invalid')
  if (Number.isFinite(createdAt) && occurredAt <= createdAt) {
    throw new DeliveryError('meta_event_precedes_lead')
  }
  if (Date.now() - occurredAt > 7 * 24 * 60 * 60 * 1000) throw new DeliveryError('meta_event_expired')
  const testCode = metaTestCode(event.source)
  if (event.test_mode && !testCode) throw new DeliveryError('meta_test_code_missing')
  const metaEvent = metaEventPayload(event)
  if (metaEvent.event_time > Math.floor(Date.now() / 1000)) throw new DeliveryError('meta_event_timestamp_pending', true)
  const payload = { data: [metaEvent], ...(event.test_mode && { test_event_code: testCode }) }
  const messaging = isMessagingConversion(event.source)
  let result
  try {
    result = await post(`https://graph.facebook.com/v27.0/${dataset}/events`, headers(token), JSON.stringify(payload))
  } catch (error) {
    if (messaging) throw new DeliveryError('messaging_delivery_uncertain', false, true)
    throw error
  }
  if (!result.ok || result.data?.error || result.data?.events_received !== 1) {
    const code = result.data?.error?.code
    const receipt = result.data?.error?.fbtrace_id ?? result.data?.fbtrace_id
    const trace = typeof receipt === 'string' ? receipt.slice(0, 255) : undefined
    if (messaging && (result.status === 408 || result.status >= 500 || (result.ok && !result.data?.error))) {
      throw new DeliveryError('messaging_delivery_uncertain', false, true, result.status, trace)
    }
    throw new DeliveryError(Number.isInteger(code) ? `meta_error_${code}` : `meta_http_${result.status}`,
      canRetry(result.status) || result.data?.error?.is_transient === true || [4, 17, 32, 613].includes(code),
      false, result.status, trace)
  }
  return typeof result.data.fbtrace_id === 'string' ? result.data.fbtrace_id.slice(0, 255) : null
}
