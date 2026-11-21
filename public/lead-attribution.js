const trackingFields = [
  'gclid', 'gbraid', 'wbraid', 'campaign_id', 'ad_group_id', 'ad_id',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
];
const storageKey = 'wacrm.lead-attribution';

export function readLeadAttribution() {
  const page = new URL(window.location.href);
  const fields = {};
  for (const name of trackingFields) {
    const value = page.searchParams.get(name)?.trim();
    if (value) fields[name] = value.slice(0, 512);
  }
  if (Object.keys(fields).length) {
    fields.landing_url = `${page.origin}${page.pathname}`;
    try { window.sessionStorage.setItem(storageKey, JSON.stringify(fields)); } catch { /* Keep current-page attribution. */ }
    return fields;
  }
  try {
    const landing = window.sessionStorage.getItem(storageKey);
    if (landing) return JSON.parse(landing);
  } catch { /* The form also works without browser storage. */ }
  return { landing_url: `${page.origin}${page.pathname}` };
}
