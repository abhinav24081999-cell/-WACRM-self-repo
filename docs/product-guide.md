# WACRM product guide

## Sign in and manage access

Use **Login** with an existing account. **Forgot password** sends a Supabase recovery email. If you received a team invitation, open its link and sign in before accepting. Platform administrators provision customer logins. See [auth setup and recovery](auth-emails.md).

A workspace is an account in the code and database. Check the workspace shown in the app before reading or updating records. Owners and admins manage team members and workspace settings. Agents perform operational work such as replying, creating contacts and moving deals. Viewers have read-only access to operational data. Ownership transfer and workspace deletion are owner controls. Some settings and provider reports have additional checks.

The **Admin** entry belongs to the configured platform administrator, who can open the workspace directory, search across workspaces, see summary counts and audit activity, and rename workspaces. Shared Vercel previews show sample data and block platform customer writes. An isolated preview can use its own data. See [workspace administration](workspace-administration.md) for plans, role permissions and billing.

## Run the inbox

1. Open **Inbox** and select a conversation. Use filters, inbox labels and conversation status to find work. Assign the thread to a teammate and add internal notes where needed.
2. Reply from the composer. WhatsApp supports text, media and voice messages, interactive replies and approved templates, subject to the connected sender and reply window. Use the template picker when a WhatsApp conversation needs a template to restart it.
3. Use message actions for quoting or reacting where supported. Review status indicators after sending. Use the AI draft or pause automatic replies for human takeover when configured.
4. Open the contact drawer for the person's details, tags and lead context. Conversation labels organize inbox threads. Contact tags classify the person and can participate in filtering and automation. Meta delivery badges summarize conversion feedback for linked leads.
5. For Instagram or Messenger, confirm the channel before replying. The current social adapter supports manual text within its configured reply window and shows placeholders for unsupported content. See [social setup](social-inbox-preview.md).

Admins configure inbox labels, reply behavior and saved **Quick replies** from Settings. Quick replies are reusable composer content. WhatsApp templates have their own lifecycle and provider approval.

## Manage contacts, leads and deals

- In **Contacts**, search and filter by tags, create or edit a person, and use CSV import for batches. Map columns and tag values during import. Review duplicates and test a small sample before importing a large list. Admins manage workspace tag definitions and custom fields under **Settings → Fields & tags**.
- In a contact's **Leads** section, review each inquiry separately, including source, ad IDs or form answers when present, qualification, follow-up dates and status history. Record the CRM outcome there. A contact can have several leads. A lead's status and a deal's stage represent different records.
- In **Pipelines**, choose a pipeline, add deals, and move them through the board. Use the pipeline settings for stages and **Settings → Deals & currency** for the workspace currency. Review the pipeline analytics for stage and deal totals. Pipelines remain available even though the redesigned contact drawer omits a deals section.
- **Dashboard** shows operational indicators such as reply queue, message activity, failures, team and pipeline or campaign summaries. **Ads performance** uses CRM leads and, when configured, external spend. Its date range is based on CRM intake in IST. Check the [metric definitions and filters](ads-performance.md) before interpreting cost figures.
- **Notifications** shows workspace/user events available to the signed-in user. Browser notifications also require browser permission. Team presence comes from the application's heartbeat.

## Send campaigns and configure templates

1. In **Settings → Templates**, manage WhatsApp templates and sync their provider status. Verify the template's language, variables, category and approval before choosing it.
2. Open **Broadcasts → New**. Choose a template, select a CRM audience or import a CSV, map recipient variables, then review, save a draft or send now. Use synthetic contacts and a test sender when evaluating a campaign.
3. Open the broadcast detail to review recipient delivery states and failure reasons. Resume interrupted delivery where available and review recipients before retrying.

## Automate conversations

**Automations** are event-driven or scheduled rules. Create a rule, pick a trigger and build its steps. Triggers include inbound and first inbound messages, keywords, new contacts, assignment, added tags, time-based rules and interactive replies. Steps can send messages, branch, wait, change tags or call a webhook. Review the rule's logs after a test. Delayed steps need a working scheduler. See [workflow operations](messaging-workflows.md) for trigger and assignment limits.

**Flows** are guided WhatsApp conversations. Start from a template or create a flow. The graph can send messages, media, buttons or lists, collect replies, branch on variables, tags or contact fields, apply a tag, hand off or end. The model includes keyword, first inbound and manual trigger types. Validate before activation and use **Runs** to review progress, timeouts and failures. Verify reply handling and handoff with a test conversation.

**Agents** provides Setup, Playground and, for authorized users, Usage. Workspace owners and admins configure a provider, instructions, knowledge sources and reply settings. The implementation includes OpenAI, Anthropic, Google Gemini, OpenAI-compatible providers and an external n8n workflow. Start with a draft or Playground. Check reply caps, follow-up signals, qualification evidence and handoff before enabling automatic replies. AI qualification outcomes and lead conversion milestones have separate meaning. See [AI provider and webhook setup](ai-agent-integrations.md).

## Connect external systems

- **WhatsApp** uses the workspace's configured Cloud API sender. Use [connection diagnostics](whatsapp-connection-troubleshooting.md) and [WABA setup](multi-waba.md) for phone IDs, registration, delivery and routing.
- **Lead capture** stores Meta Instant Form data, eligible ad referrals, Google Lead Forms and authenticated website submissions. Use the [Meta](meta-lead-preview.md) and [Google and website](google-lead-preview.md) guides. A regular chat can appear in Inbox without an ad lead.
- **Conversion feedback** sends configured qualifying milestones to Meta or Google. Go to **Settings → Conversion feedback** to manage rules and review delivery history. Negative outcomes remain in the CRM. A successful API response confirms receipt by the provider. Check provider diagnostics for matching and attribution.
- **API keys and Webhooks** under Settings allow API access and signed outbound events. Scope keys to the intended operations, use **Send test** and review delivery history before enabling an endpoint. See the [API reference](public-api.md). [MCP](mcp.md) wraps that API for compatible assistants and defaults to read-only tools.
- **Profile**, **Login & security** and **Appearance** manage personal settings such as avatar, password, sessions and theme. Workspace settings apply separately.
