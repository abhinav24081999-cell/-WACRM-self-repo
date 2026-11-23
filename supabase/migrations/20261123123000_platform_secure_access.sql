CREATE TABLE public.platform_user_provisioning_log (
  user_id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL,
  account_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_user_provisioning_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_user_provisioning_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.platform_user_provisioning_log TO service_role;

CREATE FUNCTION public.log_platform_user_provisioning()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_provisioned_by text := NEW.raw_app_meta_data->>'wacrm_provisioned_by';
BEGIN
  IF v_provisioned_by IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.raw_app_meta_data->>'wacrm_provisioned_by' = v_provisioned_by THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.platform_user_provisioning_log (user_id, actor_user_id, account_id)
  SELECT NEW.id, v_provisioned_by::uuid, a.id
  FROM public.profiles p
  JOIN public.accounts a ON a.id = p.account_id
  WHERE p.user_id = NEW.id AND p.account_role = 'owner' AND a.owner_user_id = NEW.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provisioned user has no owned account';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.log_platform_user_provisioning() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.log_platform_user_provisioning() FROM PUBLIC, anon, authenticated;

-- Auth may write app metadata after inserting the user within the same transaction.
CREATE TRIGGER on_auth_user_provisioning_audit
  AFTER INSERT OR UPDATE OF raw_app_meta_data ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_user_provisioning();
