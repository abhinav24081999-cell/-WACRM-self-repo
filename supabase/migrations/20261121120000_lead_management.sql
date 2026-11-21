-- Keep acquisition and qualification per enquiry, even when enquiries share a contact.
CREATE UNIQUE INDEX contacts_account_id_id_idx ON public.contacts (account_id, id);

CREATE TYPE public.lead_status AS ENUM (
  'new', 'interested', 'not_interested', 'busy', 'no_response',
  'in_process', 'qualified', 'converted', 'completed', 'junk'
);

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  status public.lead_status NOT NULL DEFAULT 'new',
  source text NOT NULL DEFAULT 'manual' CHECK (source IN (
    'manual', 'whatsapp', 'instagram_dm', 'messenger', 'meta_instant_form',
    'google_lead_form', 'website_form', 'other'
  )),
  source_detail text CHECK (char_length(source_detail) <= 255),
  ads_platform text CHECK (ads_platform IN ('meta', 'google')),
  attribution jsonb NOT NULL DEFAULT '{}' CHECK (
    jsonb_typeof(attribution) = 'object' AND octet_length(attribution::text) <= 16384
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- The contact owns the lead and already cascades from its account.
  FOREIGN KEY (account_id, contact_id) REFERENCES public.contacts(account_id, id) ON DELETE CASCADE
);

CREATE INDEX leads_contact_idx ON public.leads (account_id, contact_id, created_at DESC, id);

CREATE TABLE public.lead_status_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  previous_status public.lead_status,
  status public.lead_status NOT NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_by_name text,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX lead_status_history_lead_idx ON public.lead_status_history (lead_id, id DESC);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_status_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.leads, public.lead_status_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.leads, public.lead_status_history TO authenticated, service_role;
GRANT INSERT (account_id, contact_id, title, status, source, source_detail, ads_platform, attribution)
  ON public.leads TO authenticated;
GRANT UPDATE (title, status, source, source_detail, ads_platform, attribution)
  ON public.leads TO authenticated;
GRANT INSERT, UPDATE ON public.leads TO service_role;

CREATE POLICY leads_select ON public.leads FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
CREATE POLICY leads_insert ON public.leads FOR INSERT TO authenticated
  WITH CHECK (public.is_account_member(account_id, 'agent'));
CREATE POLICY leads_update ON public.leads FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));
CREATE POLICY lead_status_history_select ON public.lead_status_history FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.leads WHERE leads.id = lead_status_history.lead_id));

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Write the audit row in the same transaction. App users have read-only access to history.
CREATE FUNCTION public.record_lead_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  previous public.lead_status;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    previous := OLD.status;
    IF previous = NEW.status THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.lead_status_history (lead_id, previous_status, status, changed_by, changed_by_name)
  VALUES (
    NEW.id, previous, NEW.status, actor,
    (SELECT full_name FROM public.profiles WHERE user_id = actor)
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.record_lead_status_change() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER record_lead_status_change
  AFTER INSERT OR UPDATE OF status ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.record_lead_status_change();
