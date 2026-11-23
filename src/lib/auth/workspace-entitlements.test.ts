import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  workspaceActionAllowed,
  workspaceFeatureAllowed,
} from './workspace-entitlements';
import { choices, PLAN_FEATURES, planLimits } from './workspace-plan';

it('checks the session workspace at the database before allowing an operation', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
  const db = { rpc } as unknown as SupabaseClient;
  expect(await workspaceActionAllowed(db, 'workspace', 'inbox')).toBe(false);
  expect(rpc).toHaveBeenLastCalledWith('workspace_action_allowed', {
    p_account_id: 'workspace',
    p_action: 'inbox',
  });
  expect(await workspaceFeatureAllowed(db, 'workspace', 'ai')).toBe(false);
  expect(rpc).toHaveBeenLastCalledWith('workspace_feature_allowed', {
    p_account_id: 'workspace',
    p_feature: 'ai',
  });
});

it('preserves access before migration and propagates unrelated database errors', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ error: { code: 'PGRST202' } })
    .mockResolvedValueOnce({ error: { code: '42501' } });
  const db = { rpc } as unknown as SupabaseClient;
  await expect(workspaceFeatureAllowed(db, 'workspace', 'capi')).resolves.toBe(
    true
  );
  await expect(
    workspaceFeatureAllowed(db, 'workspace', 'capi')
  ).rejects.toMatchObject({ code: '42501' });
});

it('validates stored plan limits and enumerated plan features', () => {
  const limits = { max_contacts: 0, max_team: null, max_whatsapp: 2 };
  expect(planLimits(limits)).toEqual(limits);
  expect(planLimits({ ...limits, max_team: -1 })).toBeNull();
  expect(planLimits({ ...limits, max_whatsapp: 1.5 })).toBeNull();
  expect(choices(['ai', 'ai'], PLAN_FEATURES)).toEqual(['ai']);
  expect(choices(['untracked_feature'], PLAN_FEATURES)).toBeNull();
});
