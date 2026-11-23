import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PATCH } from './route';

const { getPlatformAdmin, isSharedPreview, rpc } = vi.hoisted(() => ({
  getPlatformAdmin: vi.fn(),
  isSharedPreview: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/platform-admin', () => ({
  getPlatformAdmin,
  isSharedPreview,
}));
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => ({ rpc }) }));

const workspaceId = '29ec548a-9f25-4931-8699-d70006526015';
const actorId = '3d0e4f27-2ad6-45ba-8df9-3c0bde7eab8b';
const context = { params: Promise.resolve({ id: workspaceId }) };

function request(name = ' New name ') {
  return new Request('https://app.example.test', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      expectedName: 'Old name',
      actorId: 'client-supplied',
    }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  getPlatformAdmin.mockResolvedValue({ id: actorId });
  isSharedPreview.mockReturnValue(false);
  rpc.mockResolvedValue({ data: 'updated', error: null });
});

describe('PATCH platform customer workspace', () => {
  it('does not open the data path for a non-platform caller', async () => {
    getPlatformAdmin.mockResolvedValue(null);
    expect((await PATCH(request(), context)).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('blocks a platform administrator from writing in the shared preview', async () => {
    isSharedPreview.mockReturnValue(true);
    expect((await PATCH(request(), context)).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('validates input and passes the authenticated actor to the rename', async () => {
    expect((await PATCH(request(' '), context)).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    expect((await PATCH(request(), context)).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('platform_rename_workspace', {
      p_account_id: workspaceId,
      p_expected_name: 'Old name',
      p_new_name: 'New name',
      p_actor_user_id: actorId,
    });
  });

  it('reports concurrent name changes to the editor', async () => {
    rpc.mockResolvedValue({ data: 'conflict', error: null });
    expect((await PATCH(request(), context)).status).toBe(409);
  });
});
