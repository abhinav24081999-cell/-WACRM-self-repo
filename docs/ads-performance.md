# Bankshakha Ads Performance and release verification

Open **Dashboard → Ads performance** as a workspace admin. The report groups leads by platform, campaign, ad set or group, and ad. Filters include date, lead source, current CRM status, and contact tag. Date ranges use India Standard Time and refer to CRM intake dates. Qualified includes current Qualified or Converted leads and Completed leads with a recorded qualification or conversion. Download the selected rows with **Export CSV**.

Spend is fetched server-side from the connected ad account and matched to the platform and entity ID. Cost per lead uses CRM leads as its denominator. Cost per qualified lead uses the qualified count. Spend and costs require a connected account and the same reporting time zone. Source, status and tag filters report CRM counts only because those filters have no equivalent spend breakdown. Rows without a resolved entity ID show under their platform with blank cost cells.

| Vercel environment variable | Purpose |
| --- | --- |
| `ADS_REPORTING_WORKSPACE_ID` | WACRM workspace UUID authorized to access the spend feeds |
| `ADS_REPORTING_META_ACCOUNT_ID`, `ADS_REPORTING_META_TOKEN` | Bankshakha ad account and server token with ads read access |
| `ADS_REPORTING_GOOGLE_CUSTOMER_ID`, `ADS_REPORTING_GOOGLE_CLIENT_EMAIL`, `ADS_REPORTING_GOOGLE_PRIVATE_KEY` | Google Ads API-enabled Cloud project and service account with access to the Bankshakha Ads customer |
| `ADS_REPORTING_GOOGLE_MANAGER_ID` | Login customer when access goes through a manager |

## Release audit

| PDF area | WACRM coverage |
| --- | --- |
| Pages 3–5, Meta lead capture | Verified webhook routes fetch details and retain original lead, form, Page and ad IDs. The recovery form in **Settings → Conversion Feedback** imports up to 20 results at a time from a form on the configured Page. Both routes deduplicate the same Meta Lead ID within a workspace. |
| Pages 6–7, CRM feedback | Meta Instant Form uses the original Lead ID, CRM payload fields, mapped funnel stage and the actual CRM stage transition time. Later events wait for the raw event in the same test or live mode. A failed or missing raw stage must be resolved to unblock later stages. |
| Pages 7–11, Business Messaging | Channel-specific payloads verify the source business account. A human confirms genuine in-thread `LeadSubmitted`; an approved rule can send `QualifiedLead`. An ambiguous provider result requires review. Purchase, checkout, cart, order lifecycle and feedback require the underlying business actions. Missing CTWA click IDs currently skip. |
| Pages 12–15, reliability and privacy | The worker records attempts, trace or request ID, destination, delivery timestamps and error category. Database access and credential routing are workspace-scoped. Campaign-specific qualification evidence and consent are operational prerequisites for deciding which real signals to share. |
| Pages 16–22, validation | Verify actual provider-side Test Events, then real event coverage and diagnostics after activation. Provider receipt, lead matching and optimization eligibility are separate checks. |
| Google lead and website intake | Google Ads native lead form and the authenticated website webhook have fixture coverage. Google offline feedback needs the configured Data Manager destination and a captured click ID or supported identifier. The Meta CRM and messaging routes cover Instant Forms and chat. A separate Meta website event source would need its own implementation and attribution. |

## Connect and verify Bankshakha's assets

1. Connect the Meta Page and grant the app Leads Access. Open the Meta form and send a test lead, then confirm the original Lead ID and attribution in WACRM.
2. Configure the Google Ads lead-form webhook using [Google lead intake](./google-lead-preview.md). Use Google Ads’ test to verify acknowledgement. Then submit an authorized sample through the active form and verify one WACRM record. The Google webhook test flag deliberately skips persistence. For a Google-attributed website form, verify the click ID survives landing page and form submission.
3. Configure provider datasets and test codes using [Conversion Feedback](./conversion-feedback.md). Create test-mode rules. For Meta CRM, map both the raw event and the later milestone before testing.
4. In Meta Events Manager, verify the event, action source, event name and dataset for each connected source. For Google Data Manager, check the API request and subsequent diagnostics. Review live match and coverage after production activation.
5. Vercel invokes the authenticated worker once daily at 02:00 UTC (07:30 IST). An operator can process due events from **Settings → Conversion Feedback**. Production sends also require the verified workspace, provider credentials, a live rule and the server-side live opt-in. Verify a real receipt and its diagnostics before treating an event as usable for optimization.

Official references include [Meta CRM payloads](https://developers.facebook.com/documentation/ads-commerce/conversions-api/conversion-leads-integration/payload-specification), [Business Messaging CAPI](https://developers.facebook.com/documentation/ads-commerce/conversions-api/business-messaging), and [Meta Lead Ads retrieval](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/retrieving).
