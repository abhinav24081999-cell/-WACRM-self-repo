# Google Ads and website lead intake

Apply the lead management, Meta lead and Google lead migrations in order on a
test Supabase database. Connect the branch preview to that database before
adding webhook credentials. The application uses the configured workspace
ID for both endpoints.

| Server environment variable | Purpose |
| --- | --- |
| `GOOGLE_LEAD_WORKSPACE_ID` | WACRM workspace UUID |
| `GOOGLE_LEAD_WEBHOOK_KEY` | Google Ads Lead Form webhook key |
| `WEBSITE_LEAD_WEBHOOK_KEY` | Separate secret for the website server |

## Google Ads Lead Forms

Use `https://<wacrm-host>/api/google/leads/webhook` in the Google Ads Lead Form
asset's webhook integration and enter the same key as `GOOGLE_LEAD_WEBHOOK_KEY`.
If the preview requires Vercel sign-in, use a test endpoint URL that Google can
reach. The Google Ads **Send test data** check returns `test_received` and leaves
the CRM clean. Submit a real test lead through an isolated test asset to verify
the lead record and available ad details. The original Google lead ID is the
deduplication key, since it identifies the submission even without a click ID.

## Website landing-page forms

Capture tracking parameters at landing time with `readLeadAttribution()` from
`public/lead-attribution.js`. Host a copy on the landing-page site so the script
can read that site's URL and reuse the attribution in the same tab. Call it
when the page opens and when building the form submission payload. The website
can run that code when its tracking consent rules permit.

Enable Google Ads auto-tagging for click IDs. To pass campaign, ad group and ad
IDs explicitly, a Google Ads final URL suffix can include:

```text
campaign_id={campaignid}&ad_group_id={adgroupid}&ad_id={creative}
```

After the website validates and stores the submission, send a server-to-server
`POST https://<wacrm-host>/api/leads/website` with `Content-Type: application/json`
and `Authorization: Bearer <website-secret>`. Keep the secret in the website
server environment. Reuse the original website submission ID on retry.

```json
{
  "submission_id": "enquiry-123",
  "form_id": "book-a-call",
  "name": "Example Lead",
  "phone": "+919990000001",
  "email": "lead@example.test",
  "attribution": {
    "gclid": "example-click-id",
    "campaign_id": "123456789",
    "utm_source": "google",
    "utm_medium": "cpc",
    "landing_url": "https://example.test/enquiry"
  },
  "answers": { "product": "Demat" }
}
```

Include at least an international phone number with `+` or an email address.
Extra form answers may be strings or arrays of strings. Test one submission
with tracking and one without. In **Contacts → contact → Leads**, check the
source, form answers, ad details, and **Unknown** where ad attribution is
missing. Resend the same submission ID to verify that it creates one lead.
