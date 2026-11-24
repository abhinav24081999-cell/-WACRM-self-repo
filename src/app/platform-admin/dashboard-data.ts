import { supabaseAdmin } from '@/lib/flows/admin-client';
import type { CommercialTotals } from '@/lib/platform/commercial';

export const WORKSPACE_PAGE_SIZE = 25;

export async function getCommercialTotals(
  shared: boolean
): Promise<CommercialTotals | null> {
  if (shared) return null;
  try {
    const { data, error } = await supabaseAdmin().rpc(
      'platform_commercial_totals'
    );
    return error ? null : (data as CommercialTotals);
  } catch {
    return null;
  }
}

export type Workspace = {
  id: string;
  name: string;
  owner_email: string | null;
  created_at: string;
  members: number;
  contacts: number;
  whatsapp: number;
};

type DashboardData = {
  totals: {
    workspaces: number;
    team: number;
    contacts: number;
    whatsapp: number;
  };
  has_more: boolean;
  workspaces: Workspace[];
  activity: {
    id: string;
    created_at: string;
    kind: 'created' | 'renamed';
    workspace_name: string | null;
    old_name: string | null;
    actor: string | null;
  }[];
};

export async function getDashboardData(
  search: string,
  offset: number,
  preview: boolean
): Promise<DashboardData | null> {
  if (preview) return null;

  try {
    const { data, error } = await supabaseAdmin().rpc(
      'platform_admin_snapshot',
      {
        p_search: search,
        p_offset: offset,
      }
    );
    if (error) {
      console.error('[platform-admin] dashboard unavailable:', error.code);
      return null;
    }
    return data as DashboardData | null;
  } catch {
    return null;
  }
}
