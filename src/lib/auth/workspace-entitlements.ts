import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlanFeature, WorkspaceAction } from './workspace-plan';

async function check(
  db: SupabaseClient,
  name: string,
  params: Record<string, string>
) {
  const { data, error } = await db.rpc(name, params);
  // The application can be deployed ahead of the migration while stored plans do not exist.
  if (error?.code === 'PGRST202' || error?.code === '42883') return true;
  if (error) throw error;
  return data === true;
}

export function workspaceFeatureAllowed(
  db: SupabaseClient,
  accountId: string,
  feature: PlanFeature
) {
  return check(db, 'workspace_feature_allowed', {
    p_account_id: accountId,
    p_feature: feature,
  });
}

export function workspaceActionAllowed(
  db: SupabaseClient,
  accountId: string,
  action: WorkspaceAction
) {
  return check(db, 'workspace_action_allowed', {
    p_account_id: accountId,
    p_action: action,
  });
}
