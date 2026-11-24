# WACRM product handbook

This handbook describes `-WACRM-self-repo` main at `eb88c7e`. Features below have code on that revision. Availability in a running instance also depends on the applied database migrations, credentials, environment and user role.

- [Product guide](product-guide.md) for agents, workspace admins and the platform operator.
- [Architecture and operations](architecture-and-operations.md) for development, deployment and support.
- [Validation and branch status](validation-and-branch-status.md) for QA, release review and features under development.

## Integration reference

| Area                                                         | Guide                                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Sign-in, password reset, onboarding and platform admin setup | [Access and auth emails](auth-emails.md)                                                                            |
| WhatsApp connection and registration                         | [Connection troubleshooting](whatsapp-connection-troubleshooting.md), [multiple WABAs](multi-waba.md)               |
| Instagram and Facebook Messenger                             | [Social inbox](social-inbox-preview.md)                                                                             |
| Lead capture                                                 | [Meta Instant Forms and ad referrals](meta-lead-preview.md), [Google Ads and website forms](google-lead-preview.md) |
| Conversion events and ad reporting                           | [Conversion feedback](conversion-feedback.md), [Ads performance](ads-performance.md)                                |
| AI providers and event webhooks                              | [AI agent integrations](ai-agent-integrations.md)                                                                   |
| External developer interfaces                                | [Public REST API and signed webhooks](public-api.md), [MCP server](mcp.md)                                          |
| Container setup                                              | [Docker](docker.md)                                                                                                 |

When a pull request changes user steps, roles, data, integrations or recovery, update the relevant guide and include verification steps in the PR. Keep account IDs, keys, real leads and provider payloads with customer data out of examples.
