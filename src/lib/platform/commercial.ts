export const ACCESS_TYPES = ['free', 'trial', 'paid', 'lifetime'] as const;
export type AccessType = (typeof ACCESS_TYPES)[number];
export type AccessState =
  'active' | 'trial' | 'suspended' | 'expired' | 'scheduled';

export type Subscription = {
  access_type: AccessType;
  billing_cycle: 'monthly' | 'yearly' | null;
  starts_on: string;
  ends_on: string | null;
  suspended: boolean;
  updated_at: string;
};

export type Payment = {
  id: string;
  amount_paise: number;
  received_on: string;
  reference: string | null;
  voided_at: string | null;
};

export type WorkspaceCommercial = {
  id: string;
  name: string;
  owner_id: string;
  today: string;
  status: AccessState;
  subscription: Subscription | null;
  payments: Payment[];
  audit: {
    id: string;
    actor: string | null;
    action: 'subscription_saved' | 'payment_recorded' | 'payment_voided';
    created_at: string;
  }[];
  usage: { messages: number; ai: number; capi: number };
};

export type CommercialTotals = {
  revenue_paise: number;
  active_paid: number;
  trials: number;
};

export function isCommercialDate(input: unknown): input is string {
  if (typeof input !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(input))
    return false;
  const date = new Date(`${input}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(input);
}
