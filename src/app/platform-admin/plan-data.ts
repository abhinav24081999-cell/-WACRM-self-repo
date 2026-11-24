import { supabaseAdmin } from '@/lib/flows/admin-client';
import { type Plan, type WorkspacePlan } from '@/lib/auth/workspace-plan';

export async function getPlans(preview: boolean): Promise<Plan[] | null> {
  if (preview) return null;
  const { data, error } = await supabaseAdmin()
    .from('platform_plans')
    .select(
      'id,name,monthly_price_paise,yearly_price_paise,max_contacts,max_team,max_whatsapp,features,archived_at'
    )
    .order('archived_at', { nullsFirst: true })
    .order('name');
  if (error) return null;
  return data as Plan[];
}

export async function getWorkspacePlans(
  ids: string[],
  preview: boolean
): Promise<WorkspacePlan[] | null> {
  if (!ids.length) return [];
  if (preview) return null;
  const { data, error } = await supabaseAdmin()
    .from('workspace_plan_settings')
    .select('account_id,plan_id,max_contacts,max_team,max_whatsapp,features')
    .in('account_id', ids);
  return error ? null : (data as WorkspacePlan[]);
}
