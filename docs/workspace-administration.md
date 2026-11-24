# Workspace administration, plans and billing

## Provision and manage access

1. As platform administrator, open **Admin** and create the customer login. Use the workspace directory to find, inspect or rename a workspace. Share the initial password privately and ask the recipient to change it.
2. As workspace owner or admin, open **Settings → Team members** to invite someone with an existing login or provision staff directly. Check the role and seat limit before submitting. An invitation assigns the invited workspace when redeemed by an eligible account. Keep the active account shown in the UI in mind before processing customer records.
3. As workspace owner, use **Role permissions** in Team members to review Admin and Agent operational permissions for Contacts, Inbox, Campaigns and Automation. Viewer accounts stay read-only. Workspace-level permissions, plan features and workspace access status also affect available actions.

## Plan catalog and assignment

1. In **Admin → Plans**, create a catalog entry with monthly and yearly INR prices, included features and contact, team and WhatsApp limits. Feature controls cover AI, automation, campaigns, API, webhooks and conversion feedback. The current messaging schema allows one WhatsApp configuration per workspace.
2. Open the workspace from the directory and assign a plan. Use workspace-level overrides for feature access or limits when needed. Lowering a limit blocks new items above the limit while keeping existing records accessible. A plan remains in effect for existing assignments after it is archived.
3. In an isolated preview, reach a low contact or seat limit and verify that creating an additional record is blocked. Confirm the existing records remain available. Change an Admin or Agent permission and check both the UI and the affected request. Confirm a second test workspace retains its own settings.

## Billing and access

1. Open a workspace's **Billing & access** page. Set Free, Trial, Paid or Lifetime access. Paid uses a monthly or yearly billing cycle. Paid and Trial require an end date. Dates use India time and access includes the end date. Future starts are Scheduled. An explicitly suspended account shows Suspended.
2. Record an INR payment already received outside WACRM, along with its received date and optional reference. Subscription settings and payment entries are independent. If a payment was entered in error, void it from the payment list. The void remains auditable. This workflow records payments and access manually.
3. Review the audit trail and last 30 days of message, AI usage and conversion-event counts. Dashboard revenue is received, non-voided payments for the current India-time calendar month to date. It is a cash-receipt total.
4. To restore restricted access, review the dates and suspension state, save the corrected subscription, and retest with a workspace login. Review the change in the audit trail. A workspace with no subscription record starts with active access.

See [release migrations and preview project settings](auth-emails.md). Implementation references include [plan rules](../src/lib/auth/workspace-plan.ts), [role permissions](../src/app/api/account/role-permissions/route.ts), [platform routes](../src/app/platform-admin), and [commercial migration](../supabase/migrations/20261123130000_platform_commercial_operations.sql).
