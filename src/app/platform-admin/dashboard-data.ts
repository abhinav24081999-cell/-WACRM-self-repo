import { supabaseAdmin } from '@/lib/flows/admin-client';

export const WORKSPACE_PAGE_SIZE = 25;

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

const sample: DashboardData = {
  totals: { workspaces: 3, team: 7, contacts: 576, whatsapp: 3 },
  has_more: false,
  workspaces: [
    {
      id: 'sample-studio',
      name: 'Northstar Studio',
      owner_email: 'maya@example.com',
      created_at: '2026-11-22T10:30:00Z',
      members: 4,
      contacts: 312,
      whatsapp: 2,
    },
    {
      id: 'sample-retail',
      name: 'Cedar Retail',
      owner_email: 'priya@example.com',
      created_at: '2026-11-20T09:20:00Z',
      members: 3,
      contacts: 186,
      whatsapp: 1,
    },
    {
      id: 'sample-support',
      name: 'Harbor Support',
      owner_email: 'sam@example.com',
      created_at: '2026-11-16T08:25:00Z',
      members: 3,
      contacts: 78,
      whatsapp: 0,
    },
  ],
  activity: [
    {
      id: 'sample-rename',
      kind: 'renamed',
      workspace_name: 'Cedar Retail',
      old_name: 'Cedar Shop',
      created_at: '2026-11-23T10:15:00Z',
      actor: 'Platform admin',
    },
    {
      id: 'sample-create',
      kind: 'created',
      workspace_name: 'Northstar Studio',
      old_name: null,
      created_at: '2026-11-22T10:30:00Z',
      actor: 'Platform admin',
    },
  ],
};

export async function getDashboardData(
  search: string,
  offset: number,
  preview: boolean
): Promise<DashboardData | null> {
  if (preview) {
    const term = search.toLowerCase();
    const workspaces = sample.workspaces.filter(
      ({ name, owner_email }) =>
        name.toLowerCase().includes(term) ||
        owner_email?.toLowerCase().includes(term)
    );
    return {
      ...sample,
      workspaces: workspaces.slice(offset, offset + WORKSPACE_PAGE_SIZE),
    };
  }

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
