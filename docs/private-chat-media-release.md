# Make chat attachments private

The new inbox code reads old and new chat storage references through an
authenticated, workspace-scoped route. For outgoing attachments, the send
service signs the storage object for Meta and keeps the original reference
in message history.

On an isolated preview, verify that both synthetic workspaces can upload,
open, download, and play their own attachments; that the other workspace
and a signed-out browser cannot open them; and that Meta test sends still
accept attachments. Conversation message API responses return short-lived
signed links to callers with the existing message-read permission. Verify
that integrations which keep attachment links fetch a fresh one when needed.

For production, obtain approval and first deploy the compatible app code.
Verify it can read existing attachments and send new ones with the bucket
still public. Apply the storage migration afterward, then verify authorized
reads and signed sends and confirm former public URLs are denied. The
migration changes visibility without moving objects or changing messages.

A warmed public attachment URL in the preview continued to serve cached
bytes immediately after the visibility change. Count existing objects before
cutover. If the bucket contains historical objects, account for the old
one-hour cache policy, confirm the provider's invalidation behavior, and
verify that a warmed anonymous URL stops serving. Privacy verification
requires both a fresh URL check and the warmed URL check. New chat uploads
and mirrored attachments use a zero-duration storage cache policy.

If a regression appears after the cutover, keep the bucket private and
restore a release that has the authenticated reader. Restore public bucket
access only as an explicitly approved emergency action, since this restores
anonymous access to existing URLs. Flow and template media have separate
delivery requirements and are outside this chat bucket migration.
