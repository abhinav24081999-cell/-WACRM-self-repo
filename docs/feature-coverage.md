# Feature documentation coverage

Source baseline is main at `affd9e7`. Each group covers the listed App Router pages and API families. Paths in the first column are product routes. The mapping covers user-facing and operational entry points, including supporting API families that are not public contracts.

| Product route or feature | API family | Documentation |
| --- | --- | --- |
| `/`, `/login`, `/forgot-password`, `/reset-password`, `/join/[token]` | `/auth/callback`, `/api/invitations` | [Auth and recovery](auth-emails.md), [workspace onboarding](workspace-administration.md) |
| `/dashboard`, `/notifications` | Dashboard and notification queries | [Reporting, notifications and presence](crm-workflows.md#pipeline-and-reports) |
| `/ads-performance` | `/api/ads-performance` | [Ads Performance](ads-performance.md) |
| `/inbox` | `/api/inbox`, `/api/quick-replies`, `/api/whatsapp`, `/api/social` | [Inbox and templates](messaging-workflows.md#inbox-saved-replies-and-whatsapp-templates), [WhatsApp troubleshooting](whatsapp-connection-troubleshooting.md), [multiple WABAs](multi-waba.md), [social inbox](social-inbox-preview.md) |
| `/contacts`, `/pipelines` | `/api/contacts`, CRM queries | [Contacts, lead records and deals](crm-workflows.md) |
| Lead intake and conversion feedback | `/api/meta/leads`, `/api/google/leads`, `/api/leads`, `/api/conversion-feedback` | [Meta](meta-lead-preview.md), [Google Ads and website](google-lead-preview.md), [conversion feedback](conversion-feedback.md) |
| `/broadcasts`, `/broadcasts/new`, `/broadcasts/[id]` | `/api/whatsapp/broadcast` | [Broadcasts and delivery recovery](messaging-workflows.md#broadcasts) |
| `/automations`, `/automations/new`, `/automations/[id]/edit`, `/automations/[id]/logs` | `/api/automations` | [Automation builder, logs and scheduler](messaging-workflows.md#automations) |
| `/flows`, `/flows/[id]`, `/flows/[id]/runs` | `/api/flows` | [Flows, runs and timeouts](messaging-workflows.md#flows) |
| `/agents` | `/api/ai` | [AI setup, knowledge, qualification and takeover](ai-agent-integrations.md) |
| `/settings` | `/api/account` | [Product guide](product-guide.md), [team and role permissions](workspace-administration.md), [API keys and webhooks](public-api.md) |
| `/platform-admin`, `/platform-admin/plans`, `/platform-admin/commercial/[id]` | `/api/platform-admin` | [Super Admin, plans and billing](workspace-administration.md), [release and preview prerequisites](auth-emails.md) |
| Public API, outgoing events and MCP | `/api/v1`, `/api/account/webhooks` | [REST and webhook contract](public-api.md), [MCP](mcp.md) |

For local setup, migration order, cron and rollback, use [architecture and operations](architecture-and-operations.md) and [Docker](docker.md). For two-workspace smoke tests and branch status, use [validation and branch status](validation-and-branch-status.md). Update this index in the same PR when product routes or API families change.
