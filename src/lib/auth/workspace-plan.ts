export const PLAN_FEATURES = [
  'ai',
  'automation',
  'campaigns',
  'api',
  'webhooks',
  'capi',
] as const;
export const ROLE_ACTIONS = [
  'contacts',
  'inbox',
  'campaigns',
  'automation',
] as const;
export const PLAN_LIMITS = [
  'max_contacts',
  'max_team',
  'max_whatsapp',
] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];
export type WorkspaceAction = (typeof ROLE_ACTIONS)[number];
export type PlanLimits = Record<(typeof PLAN_LIMITS)[number], number | null>;

export type Plan = PlanLimits & {
  id: string;
  name: string;
  monthly_price_paise: number;
  yearly_price_paise: number;
  features: PlanFeature[];
  archived_at: string | null;
};
export type WorkspacePlan = PlanLimits & {
  account_id: string;
  plan_id: string;
  features: PlanFeature[] | null;
};

export function choices<T extends string>(
  value: unknown,
  allowed: readonly T[]
): T[] | null {
  if (
    !Array.isArray(value) ||
    value.length > allowed.length ||
    value.some((item) => !allowed.includes(item))
  )
    return null;
  return [...new Set(value)] as T[];
}

export function planLimits(value: Record<string, unknown>): PlanLimits | null {
  const { max_contacts, max_team, max_whatsapp } = value;
  const valid = (limit: unknown) =>
    limit === null ||
    (typeof limit === 'number' &&
      Number.isInteger(limit) &&
      limit >= 0 &&
      limit <= 2_147_483_647);
  if (
    !valid(max_contacts) ||
    !valid(max_team) ||
    (max_whatsapp !== null && max_whatsapp !== 0 && max_whatsapp !== 1)
  )
    return null;
  return { max_contacts, max_team, max_whatsapp } as PlanLimits;
}
