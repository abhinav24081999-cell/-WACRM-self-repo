# Messaging, campaigns and workflow operations

## Inbox, saved replies and WhatsApp templates

In **Inbox**, select a thread, assign it when needed and use internal notes for staff context. Use the composer for channel-supported text and media, and use the template picker when the WhatsApp service window requires an approved template. Use conversation labels to filter threads and contact tags for CRM classification. [Social inbox](social-inbox-preview.md) covers Instagram and Messenger's text and attachment limits.

In **Settings → Quick replies**, manage reusable composer responses. In **Settings → Templates**, create or edit templates, submit them to Meta, sync status and review the approved language and category. Keep placeholders aligned with the values the sender will provide. Verify template delivery and check the failed message details when Meta rejects a send. See [WhatsApp connection troubleshooting](whatsapp-connection-troubleshooting.md).

## Broadcasts

1. Open **Broadcasts → New**, select an approved template, and choose an audience from all contacts, tags, a field filter or CSV. Check the audience and personalization values, including the fallback for missing data.
2. On the final review screen, select **Save draft** or **Send now**. The current wizard offers these two actions. There is no scheduled broadcast runner wired up in the reviewed code.
3. Open the campaign detail and check per-recipient status. For interrupted sends, use the available resume action and inspect the recipient list before retrying. The worker and status webhook update campaign recipient records.

## Automations

1. Open **Automations → New**, pick an event such as first inbound, keyword, tag added or interactive reply, then configure and activate the rule. Test the actual trigger with two synthetic contacts. Use the rule detail's execution logs to check success, partial completion or failure.
2. Steps include sending text, a template, buttons or a list, writing tags and contact fields, assigning or closing a conversation, creating a deal, waiting, conditions and outbound webhooks. When predictable assignment matters, pick a specific teammate. The current **Round robin** mode selects one matching workspace member without rotating through the team.
3. Timed waits depend on the automation cron. A button message configured to wait for a reply resumes when the matching input arrives and expires after 24 hours. The builder exposes a time-based trigger, but the configured cron handler drains pending executions. Verify a separate trigger source before promising recurring campaigns.

## Flows

In **Flows**, create a flow from a template or start with the editor. Link Start to the message, question, condition, tag, handoff or end nodes you need. Validate and activate the graph. Use an inbound keyword or first inbound test to see the run in **Runs**. Exercise each button branch, an unexpected answer, an abandoned run and a handoff. One active run per contact is permitted. Timeout cleanup frees an abandoned run so future triggers can start a new one.

| Worker | Schedule setup | Check after testing |
| --- | --- | --- |
| Automation waits and reply expiry | Authenticated GET to `/api/automations/cron` with `x-cron-secret` matching server-only `AUTOMATION_CRON_SECRET` | Check processed, expired and requeued counts and the rule logs. |
| Flow timeouts | Authenticated GET to `/api/flows/cron` with the same header and secret | Check the swept count and the run's timeout event. |

The checked-in Vercel schedule runs conversion feedback only. Configure these two worker calls separately in the intended environment. See the [automation builder](../src/components/automations), [flow editor](../src/components/flows), [broadcast wizard](../src/components/broadcasts), and [Vercel schedule](../vercel.json).
