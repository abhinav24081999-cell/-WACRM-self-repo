-- Validate only after checking legacy rows in the target database.
CREATE UNIQUE INDEX conversations_account_id_id_idx ON public.conversations (account_id, id);
CREATE UNIQUE INDEX pipelines_account_id_id_idx ON public.pipelines (account_id, id);
CREATE UNIQUE INDEX pipeline_stages_pipeline_id_id_idx ON public.pipeline_stages (pipeline_id, id);
CREATE UNIQUE INDEX messages_conversation_id_id_idx ON public.messages (conversation_id, id);

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_workspace_contact_fkey
  FOREIGN KEY (account_id, contact_id) REFERENCES public.contacts (account_id, id)
  ON DELETE CASCADE NOT VALID;

ALTER TABLE public.deals
  ADD CONSTRAINT deals_workspace_contact_fkey
    FOREIGN KEY (account_id, contact_id) REFERENCES public.contacts (account_id, id)
    ON DELETE SET NULL (contact_id) NOT VALID,
  ADD CONSTRAINT deals_workspace_conversation_fkey
    FOREIGN KEY (account_id, conversation_id) REFERENCES public.conversations (account_id, id) NOT VALID,
  ADD CONSTRAINT deals_workspace_pipeline_fkey
    FOREIGN KEY (account_id, pipeline_id) REFERENCES public.pipelines (account_id, id)
    ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT deals_pipeline_stage_fkey
    FOREIGN KEY (pipeline_id, stage_id) REFERENCES public.pipeline_stages (pipeline_id, id) NOT VALID;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_conversation_reply_fkey
  FOREIGN KEY (conversation_id, reply_to_message_id) REFERENCES public.messages (conversation_id, id)
  ON DELETE SET NULL (reply_to_message_id) NOT VALID;

ALTER TABLE public.conversations VALIDATE CONSTRAINT conversations_workspace_contact_fkey;
ALTER TABLE public.deals VALIDATE CONSTRAINT deals_workspace_contact_fkey;
ALTER TABLE public.deals VALIDATE CONSTRAINT deals_workspace_conversation_fkey;
ALTER TABLE public.deals VALIDATE CONSTRAINT deals_workspace_pipeline_fkey;
ALTER TABLE public.deals VALIDATE CONSTRAINT deals_pipeline_stage_fkey;
ALTER TABLE public.messages VALIDATE CONSTRAINT messages_conversation_reply_fkey;

-- Keep the original relationship names and a single foreign key per
-- relationship so existing PostgREST embeds remain unambiguous.
ALTER TABLE public.conversations DROP CONSTRAINT conversations_contact_id_fkey;
ALTER TABLE public.conversations RENAME CONSTRAINT conversations_workspace_contact_fkey TO conversations_contact_id_fkey;

ALTER TABLE public.deals
  DROP CONSTRAINT deals_contact_id_fkey,
  DROP CONSTRAINT deals_conversation_id_fkey,
  DROP CONSTRAINT deals_pipeline_id_fkey,
  DROP CONSTRAINT deals_stage_id_fkey;
ALTER TABLE public.deals RENAME CONSTRAINT deals_workspace_contact_fkey TO deals_contact_id_fkey;
ALTER TABLE public.deals RENAME CONSTRAINT deals_workspace_conversation_fkey TO deals_conversation_id_fkey;
ALTER TABLE public.deals RENAME CONSTRAINT deals_workspace_pipeline_fkey TO deals_pipeline_id_fkey;
ALTER TABLE public.deals RENAME CONSTRAINT deals_pipeline_stage_fkey TO deals_stage_id_fkey;

ALTER TABLE public.messages DROP CONSTRAINT messages_reply_to_message_id_fkey;
ALTER TABLE public.messages RENAME CONSTRAINT messages_conversation_reply_fkey TO messages_reply_to_message_id_fkey;
