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
  return process.env.VERCEL === '1' && process.env.VERCEL_ENV !== 'production';
}
