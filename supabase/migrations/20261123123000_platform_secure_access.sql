CREATE TABLE public.platform_user_provisioning_log (
  user_id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL,
  account_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_user_provisioning_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_user_provisioning_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.platform_user_provisioning_log TO service_role;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name text := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  v_account_id uuid;
  v_provisioned_by text := NEW.raw_app_meta_data->>'wacrm_provisioned_by';
BEGIN
  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  IF v_provisioned_by IS NOT NULL THEN
    INSERT INTO public.platform_user_provisioning_log (user_id, actor_user_id, account_id)
    VALUES (NEW.id, v_provisioned_by::uuid, v_account_id);
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Provisioning must roll back if any part of the account setup fails.
  IF v_provisioned_by IS NOT NULL THEN
    RAISE;
  END IF;
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;
