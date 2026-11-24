-- Deploy the authenticated chat media reader before applying this migration.
UPDATE storage.buckets SET public = false WHERE id = 'chat-media';
