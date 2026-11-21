# Instagram and Messenger inbox preview

Apply `20261121072456_social_inbox.sql` before setting up the channels.
When the preview shares the WACRM Supabase project, use a separate test login
and workspace in that project. Set both channel connections to the test
workspace so the production inbox does not receive preview messages.
The first version supports one connection per social channel per deployment.

Set these server-only environment variables for the preview branch:

| Suffix | `SOCIAL_INSTAGRAM_` | `SOCIAL_MESSENGER_` |
| --- | --- | --- |
| `WORKSPACE_ID` | Test workspace UUID | Test workspace UUID |
| `ACCOUNT_ID` | Instagram professional account ID from Unified Login | Facebook Page ID |
| `ACCOUNT_LABEL` | Instagram handle | Facebook Page name |
| `ACCESS_TOKEN` | Instagram Unified Login system-user access token | Page access token |
| `APP_SECRET` | Meta App Secret that signs Instagram webhooks | Meta App Secret |
| `VERIFY_TOKEN` | A random string for the Instagram callback challenge | A random string for the Messenger callback challenge |

Use an Instagram Unified Login configuration with `instagram_basic` and
`instagram_manage_messages`. The preview uses a configured system-user token
for the selected Instagram account. For Messenger, authorize the Page and
subscribe the app to the Page with `pages_messaging`. With a development app,
use a sender allowed by the relevant Meta app roles and settings.

Use the preview's stable URL and configure the Instagram and Page webhook
subscriptions separately:

- Instagram callback: `/api/social/webhook/instagram`. Subscribe to `messages`.
- Page callback: `/api/social/webhook/messenger`. Subscribe to `messages` and
  `message_echoes` if available for the Page.

Each callback checks the corresponding verify token and HMAC-signature secret.
If Deployment Protection is on, Meta needs a callback URL it can reach. Keep
the WhatsApp webhook configuration in place.

Send a DM from a test sender to each connected account. Confirm that the right
workspace shows the channel and account, and reply in the thread. Verify the
reply in the originating app. Replaying a signed delivery with the same
message ID should not add another bubble or increase the unread count.

This preview supports inbound text and manual text replies within the standard
24-hour window. It shows a placeholder for attachments and other unsupported
events. Contact linking across channels, media transfer, read receipts, and
extended Meta reply windows are outside this version.
