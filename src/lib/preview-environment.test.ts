import { describe, expect, it } from 'vitest';
import { assertPreviewDatabase } from './preview-environment';

const preview = 'p'.repeat(20);
const live = 'l'.repeat(20);
const config = {
  VERCEL_ENV: 'preview',
  WACRM_ISOLATED_PREVIEW_PROJECT_REF: preview,
  WACRM_LIVE_SUPABASE_PROJECT_REF: live,
  NEXT_PUBLIC_SUPABASE_URL: `https://${preview}.supabase.co`,
};

describe('Vercel Preview database isolation', () => {
  it('requires a preview project distinct from production', () => {
    expect(() => assertPreviewDatabase(config)).not.toThrow();
    expect(() => assertPreviewDatabase({ ...config, WACRM_LIVE_SUPABASE_PROJECT_REF: preview })).toThrow();
    expect(() => assertPreviewDatabase({ ...config, WACRM_ISOLATED_PREVIEW_PROJECT_REF: undefined })).toThrow();
  });

  it('rejects a different or inherited database URL', () => {
    expect(() => assertPreviewDatabase({
      ...config,
      NEXT_PUBLIC_SUPABASE_URL: `https://${live}.supabase.co`,
    })).toThrow();
  });

  it('leaves production and local builds unchanged', () => {
    expect(() => assertPreviewDatabase({ VERCEL_ENV: 'production' })).not.toThrow();
    expect(() => assertPreviewDatabase({})).not.toThrow();
  });
});
