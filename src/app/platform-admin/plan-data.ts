import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  PLAN_FEATURES,
  type Plan,
  type WorkspacePlan,
} from '@/lib/auth/workspace-plan';

const demoPlans: Plan[] = [
  {
    id: 'sample-starter',
    name: 'Starter',
    monthly_price_paise: 149900,
    yearly_price_paise: 1499000,
    max_contacts: 1500,
    max_team: 2,
    max_whatsapp: 1,
    features: ['campaigns'],
    archived_at: null,
  },
  {
    id: 'sample-plus',
    name: 'Plus',
    monthly_price_paise: 349900,
    yearly_price_paise: 3499000,
    max_contacts: 10000,
    max_team: 8,
    max_whatsapp: 1,
    features: ['ai', 'automation', 'campaigns', 'webhooks', 'capi'],
    archived_at: null,
  },
  {
    id: 'sample-enterprise',
    name: 'Enterprise',
    monthly_price_paise: 0,
    yearly_price_paise: 0,
    max_contacts: null,
    max_team: null,
    max_whatsapp: 1,
    features: [...PLAN_FEATURES],
    archived_at: null,
  },
];

export async function getPlans(preview: boolean): Promise<Plan[] | null> {
  if (preview) return demoPlans;
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
  if (preview)
    return ids
      .filter((id) => id === 'sample-retail' || id === 'sample-studio')
      .map((id) => ({
        account_id: id,
        plan_id: id === 'sample-retail' ? 'sample-starter' : 'sample-plus',
        max_contacts: null,
        max_team: id === 'sample-retail' ? 4 : null,
        max_whatsapp: null,
        features: null,
      }));
  const { data, error } = await supabaseAdmin()
    .from('workspace_plan_settings')
    .select('account_id,plan_id,max_contacts,max_team,max_whatsapp,features')
    .in('account_id', ids);
  return error ? null : (data as WorkspacePlan[]);
}
