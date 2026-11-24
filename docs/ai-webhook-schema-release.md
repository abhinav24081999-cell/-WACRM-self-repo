# Release AI settings and webhook schema together

The app selects the AI agent and qualification columns even when a workspace has
no AI configuration. A database without those columns returns a query error.
The webhook manager also requires its delivery table and endpoint columns.

1. Confirm the release's Supabase project. Run
   `supabase/ci/verify-ai-webhook-schema.sql` against it as the database owner.
   The check reads metadata and validates column references without writing data.
2. In an isolated rehearsal, compare the existing schema and migration ledger
   against `20261123120000_ai_provider_connections.sql`,
   `20261123121000_webhook_manager.sql`,
   `20261123122000_ai_contact_qualification.sql`,
   `20261124122743_inbound_ai_reply_claim.sql`, and
   `20261124123953_inbound_ai_generation_lease.sql`. Apply the missing scripts in
   that order. If the schema was partly applied or the ledger names differ,
   reconcile the actual objects and recorded versions before running anything.
3. Rerun the schema check. Use two test workspaces to save and reload different
   AI settings, and confirm webhook settings and delivery history are scoped to
   their own workspace. Use test provider credentials and endpoints.
4. For production, obtain approval and confirm the backup and recovery point.
   Recheck the live schema and ledger, then apply only the verified missing
   changes through the approved migration workflow. Rerun the schema check and
   verify an authorized AI settings page loads. Record which versions ran.

Rollback application changes to a release compatible with the existing database.
Keep successfully added AI and webhook data in place. If a migration fails
partway, inspect committed changes and verify the database state before
continuing. Dropping the new columns or tables can discard configuration and
delivery history. Use an approved forward repair or restore procedure if needed.
