export type Attribution = Record<string, string>

export function metaText(value: unknown, limit = 255) {
  return typeof value === 'string' ? value.replaceAll('\0', '').trim().slice(0, limit).toWellFormed() : ''
}

export function metaId(value: unknown) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) value = String(value)
  return typeof value === 'string' && /^\d{1,40}$/.test(value) ? value : ''
}

export function fields(values: Attribution): Attribution {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ''))
}

export function referralAttribution(referral: Record<string, unknown>, whatsapp = false): Attribution {
  const clickId = whatsapp ? metaText(referral.ctwa_clid, 512) : ''
  const source = metaText(whatsapp ? referral.source_type : referral.source)
  const adId = whatsapp ? (source === 'ad' ? metaId(referral.source_id) : '') : metaId(referral.ad_id)
  if (!clickId && !adId && source.toLowerCase() !== (whatsapp ? 'ad' : 'ads')) return {}

  const context = referral.ads_context_data as Record<string, unknown> | undefined
  return fields({
    ad_id: adId,
    ctwa_clid: clickId,
    referral_source: source,
    referral_type: metaText(referral.type),
    referral_ref: metaText(referral.ref, 512),
    referral_headline: metaText(referral.headline ?? context?.ad_title, 512),
    referral_url: metaText(referral.source_url, 2048),
  })
}

export async function readGraphObject(id: string, selection: string, token: string, timeout: number) {
  const url = new URL(`https://graph.facebook.com/v27.0/${id}`)
  url.searchParams.set('fields', selection)
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(timeout),
  })
  if (!response.ok) throw new Error(`Meta Graph HTTP ${response.status}`, { cause: response.status })
  return response.json()
}

export async function enrichAd(attribution: Attribution, token?: string) {
  if (!attribution.ad_id || !token) return attribution
  try {
    const ad = await readGraphObject(
      attribution.ad_id, 'name,campaign_id,adset_id,campaign{name},adset{name}', token, 2000,
    )
    return {
      ...attribution,
      ...fields({
        ad_name: metaText(ad?.name),
        campaign_id: metaId(ad?.campaign_id),
        campaign_name: metaText(ad?.campaign?.name),
        ad_group_id: metaId(ad?.adset_id),
        ad_group_name: metaText(ad?.adset?.name),
      }),
    }
  } catch {
    // Ad-account access is optional. The original attribution stays usable.
    return attribution
  }
}
