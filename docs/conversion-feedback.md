# Conversion feedback

Phase 4 uses the lead records and status history from Phases 1–3. Apply the
conversion feedback migration after those migrations. Use a separate Supabase
database for preview tests. The migration creates
workspace rules and a delivery queue. Saving a CRM milestone and creating its
automatic event happen in the same database transaction.

Open **Settings → Conversion feedback** as a workspace admin. Add one rule
for each source and milestone you want to report. Automatic rules apply to
new status changes. Manual rules can be queued from a lead's detail view once
it has reached that milestone. To report the initial stage of an already
qualified Instant Form lead, select **New** and use its historical stage time.

| Source | Milestones | Destination |
| --- | --- | --- |
| Meta Instant Forms | New, Qualified, Converted | Meta CRM dataset with the event names mapped to the advertiser's funnel |
| WhatsApp, Instagram Direct, Messenger | New, Qualified | Channel-specific Meta dataset using `LeadSubmitted` or `QualifiedLead` |
| Google Lead Forms and Google-attributed website forms | Qualified, Converted | Google Ads conversion action IDs through Data Manager |

Use distinct Google conversion action IDs for distinct milestones. Only use a
Meta event in accordance with its actual business meaning. Negative outcomes
stay in WACRM. The current lead editor does not capture a messaging purchase
amount or currency, so Converted is available for Google and Meta Instant Forms.

## Server settings

Set `CONVERSION_FEEDBACK_WORKSPACE_ID` to the Bankshakha CRM workspace UUID.
Configure server-side variables for the destinations being used.

| Variables | Purpose |
| --- | --- |
| `CONVERSION_META_{CRM,WHATSAPP,INSTAGRAM,MESSENGER}_DATASET_ID` and `_ACCESS_TOKEN` | Separate Meta destination and authorized token for each enabled route |
| `CONVERSION_META_{WHATSAPP,INSTAGRAM,MESSENGER}_ACCOUNT_ID` | Source account associated with that route's dataset |
| `CONVERSION_META_{CRM,WHATSAPP,INSTAGRAM,MESSENGER}_TEST_CODE` | Test Events code for each Meta dataset |
| `CONVERSION_GOOGLE_CUSTOMER_ID`, optional `CONVERSION_GOOGLE_MANAGER_ID` | Google Ads operating customer and optional manager |
| `CONVERSION_GOOGLE_CLIENT_EMAIL`, `CONVERSION_GOOGLE_PRIVATE_KEY` | Server credentials for an authorized Google service account with access to the Data Manager API and Google Ads destination |
| `CONVERSION_FEEDBACK_ALLOW_LIVE` | Set to `true` at production activation after testing. Vercel previews only process test events. |

The worker sends the original Meta lead ID, WhatsApp click ID with its business
account ID, or the appropriate Instagram/Messenger scoped IDs. Google uses a
captured GCLID, GBRAID or WBRAID. The Google lead submission ID is included when
available alongside a click ID. Events without usable matching identifiers are
logged as skipped. This flow does not send contact phone, email, form answers
or customer names. Only activate destinations you are authorized to share data with.

## Testing and delivery

1. Add a rule in **Test mode** and queue a test lead from the matching source.
2. Click **Process queue**. Meta receives its Test Events code and Google runs
   validation only. Verify the result in Meta Test Events or the Google response.
3. Review **Delivery history**. API acceptance is separate from attribution or
   campaign reporting. Use the response ID for provider diagnostics.
4. Configure a scheduler to call `GET /api/conversion-feedback/cron`. Use
   `Authorization: Bearer <CRON_SECRET>` with a Vercel scheduler or the
   app's existing `x-cron-secret` / `AUTOMATION_CRON_SECRET` convention.
5. After authorization, enable live sending and switch the tested rules to
   **Live mode**. Keep the destination for a queued event stable across retries.

Retries preserve the original event ID and milestone time. Temporary network,
throttling and server errors are retried automatically. Fix configuration or
data errors before retrying a failed event. A recovered queue lease reclaims an
interrupted attempt without creating a second event row.
