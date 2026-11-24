# Make chat attachments private

The new inbox code reads old and new chat storage references through an
authenticated, workspace-scoped route. For outgoing attachments, the send
service signs the storage object for Meta and keeps the original reference
in message history.

On an isolated preview, verify that both synthetic workspaces can upload,
open, download, and play their own attachments; that the other workspace
and a signed-out browser cannot open them; and that Meta test sends still
accept attachments. Check any API consumers that read `media_url`: old
public chat storage URLs intentionally stop serving files after the cutover.

For production, obtain approval and first deploy the compatible app code.
Verify it can read existing attachments and send new ones with the bucket
still public. Apply the storage migration afterward, then verify authorized
reads and signed sends and confirm former public URLs are denied. The
migration changes visibility without moving objects or changing messages.

If a regression appears after the cutover, keep the bucket private and
restore a release that has the authenticated reader. Restore public bucket
access only as an explicitly approved emergency action, since this restores
anonymous access to existing URLs. Flow and template media have separate
delivery requirements and are outside this chat bucket migration.
