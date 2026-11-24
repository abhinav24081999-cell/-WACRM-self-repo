export function assertPreviewDatabase(env: NodeJS.ProcessEnv) {
  if (env.VERCEL_ENV !== 'preview') return;

  const preview = env.WACRM_ISOLATED_PREVIEW_PROJECT_REF?.trim();
  const live = env.WACRM_LIVE_SUPABASE_PROJECT_REF?.trim();
  const validRef = /^[a-z]{20}$/;
  if (!preview || !live || !validRef.test(preview) || !validRef.test(live) ||
      preview === live ||
      env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, '') !== `https://${preview}.supabase.co`) {
    throw new Error('Vercel Preview requires an explicitly isolated Supabase project.');
  }
}
