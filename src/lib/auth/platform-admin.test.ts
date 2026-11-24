import { afterEach, expect, it, vi } from 'vitest';
import { isSharedPreview } from './platform-admin';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
afterEach(() => vi.unstubAllEnvs());

it('only enables preview writes for the configured isolated project', () => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('WACRM_LIVE_SUPABASE_PROJECT_REF', 'aaaaaaaaaaaaaaaaaaaa');
  vi.stubEnv('WACRM_ISOLATED_PREVIEW_PROJECT_REF', 'bbbbbbbbbbbbbbbbbbbb');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co');
  expect(isSharedPreview()).toBe(true);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://bbbbbbbbbbbbbbbbbbbb.supabase.co');
  expect(isSharedPreview()).toBe(false);
  vi.stubEnv('WACRM_LIVE_SUPABASE_PROJECT_REF', 'bbbbbbbbbbbbbbbbbbbb');
  expect(isSharedPreview()).toBe(true);
});
