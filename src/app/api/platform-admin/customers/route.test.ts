import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getUser, checkSchema, createUser } = vi.hoisted(() => ({
  getUser: vi.fn(),
  checkSchema: vi.fn(),
  createUser: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ limit: checkSchema }) }),
    auth: { admin: { createUser } },
  }),
}));

import { POST } from './route';

const adminId = '29ec548a-9f25-4931-8699-d70006526015';

function request(
  body = { email: '  SAMPLE@example.test ', name: ' Sample customer ' }
) {
  return new Request('https://app.example.test/api/platform-admin/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('WACRM_PLATFORM_ADMIN_USER_ID', adminId);
  vi.stubEnv('VERCEL', '');
  getUser.mockResolvedValue({ data: { user: { id: adminId } }, error: null });
  checkSchema.mockResolvedValue({ error: null });
  createUser.mockResolvedValue({ error: null });
});

afterEach(() => vi.unstubAllEnvs());

describe('POST /api/platform-admin/customers', () => {
  it.each([null, { id: 'workspace-owner', app_metadata: { role: 'owner' } }])(
    'denies a caller other than the verified platform admin',
    async (user) => {
      getUser.mockResolvedValue({ data: { user }, error: null });
      expect((await POST(request())).status).toBe(403);
      expect(checkSchema).not.toHaveBeenCalled();
      expect(createUser).not.toHaveBeenCalled();
    }
  );

  it('denies provisioning when the admin identity is unset', async () => {
    vi.stubEnv('WACRM_PLATFORM_ADMIN_USER_ID', '');
    expect((await POST(request())).status).toBe(403);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('denies provisioning from Vercel Preview even for the platform admin', async () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect((await POST(request())).status).toBe(403);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('validates the customer before calling the Auth admin API', async () => {
    expect((await POST(request({ email: 'invalid', name: '' }))).status).toBe(
      400
    );
    expect(createUser).not.toHaveBeenCalled();
  });

  it('requires the audit schema to be available before provisioning', async () => {
    checkSchema.mockResolvedValue({ error: { code: 'PGRST205' } });
    expect((await POST(request())).status).toBe(503);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('creates credentials with a server-generated password and records the actor', async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const { email, password } = await response.json();
    expect(email).toBe('sample@example.test');
    expect(password).toMatch(/^[\w-]{32}aA1!$/);
    expect(createUser).toHaveBeenCalledWith({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'Sample customer' },
      app_metadata: { wacrm_provisioned_by: adminId },
    });
  });

  it('reports a duplicate without replacing the existing login', async () => {
    createUser.mockResolvedValue({ error: { code: 'email_exists' } });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty('password');
  });
});
