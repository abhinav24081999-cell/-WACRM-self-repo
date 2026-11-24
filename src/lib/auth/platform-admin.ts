import { createClient } from '@/lib/supabase/server';

export async function getPlatformAdmin() {
  const adminId = process.env.WACRM_PLATFORM_ADMIN_USER_ID?.trim();
  if (!adminId) return null;

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  return !error && user?.id === adminId ? user : null;
}

export function isSharedPreview() {
  if (process.env.VERCEL !== '1' || process.env.VERCEL_ENV === 'production')
    return false;
  const ref = process.env.WACRM_ISOLATED_PREVIEW_PROJECT_REF;
  const live = process.env.WACRM_LIVE_SUPABASE_PROJECT_REF;
  return (
    !ref ||
    !live ||
    ref === live ||
    !/^[a-z0-9]{20}$/.test(ref) ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '') !==
      `https://${ref}.supabase.co`
  );
}
