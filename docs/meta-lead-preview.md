# Meta lead capture preview

Use a test Supabase project and Meta test assets. Apply the social inbox,
lead management and Meta lead migrations in order before testing webhooks.

Apply the database migrations before setting `META_LEAD_WORKSPACE_ID`, which
enables lead capture for that workspace. For a fresh WACRM database, apply
the earlier application migrations first. Inbox messages still arrive
before lead capture is enabled.

For Facebook and Instagram Instant Forms, configure these preview-only server variables.

| Variable | Value |
| --- | --- |
| `META_LEAD_WORKSPACE_ID` | WACRM test workspace UUID |
| `META_LEAD_PAGE_ID` | Facebook Page that owns the forms |
| `META_LEAD_PAGE_ACCESS_TOKEN` | Page token with leads retrieval and access to the forms |
| `META_LEAD_APP_SECRET` | Secret for the app that signs Page events |
| `META_LEAD_VERIFY_TOKEN` | Token for the dedicated Page webhook challenge |
| `META_LEAD_ADS_ACCESS_TOKEN` | Optional token with access to the relevant ad account for campaign, ad set and ad names |

Subscribe the app and Page to `leadgen`. Use `/api/meta/leads/webhook` for
a separate Meta app. When using the same app and Page as the Messenger inbox,
keep the existing `/api/social/webhook/messenger` callback and add `leadgen`
to its subscriptions. The Page, workspace and app secret must match the
Messenger configuration. Meta needs a callback reachable over HTTPS without
Vercel's interactive login prompt.

Callback verification uses the configured workspace, Page and verify token.
Receiving submissions additionally requires the signing app secret and Page access
token. In **Settings → Conversion Feedback**, the credential indicators show
which steps are configured. A real Meta test lead and the Test Events response
confirm delivery.

The WhatsApp `messages` webhook already receives ad referral information. For
Instagram and Messenger, keep `messages` and subscribe to `messaging_referrals`
and `messaging_postbacks` where Meta exposes them. If Instagram uses the
[Edge Function receiver](social-inbox-preview.md#instagram-inbound-delivery-on-a-protected-preview),
include both shared modules in the test deployment. Set `META_LEAD_WORKSPACE_ID`
as an Edge Function secret to enable capture. Set the optional ad-account token
there as well if you want enrichment.

Submit an Instant Form from a test Page and use test ad referrals for each
channel. In **Contacts → contact → Leads**, check the source, status, external
lead ID, available ad attribution and answers to custom form questions.
Replay each payload to check that its
lead appears once. An ad lookup failure should still leave the IDs supplied by
the webhook. An ordinary chat should appear in the inbox without creating an
ad lead. If an ad-referred WhatsApp message and lead cannot be committed,
the webhook sends a retryable response. Replies and automations run after
acknowledgment.
