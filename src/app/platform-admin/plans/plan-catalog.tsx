'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  PLAN_FEATURES,
  PLAN_LIMITS,
  type Plan,
} from '@/lib/auth/workspace-plan';

const empty: Omit<Plan, 'id'> = {
  name: '',
  monthly_price_paise: 0,
  yearly_price_paise: 0,
  max_contacts: null,
  max_team: null,
  max_whatsapp: null,
  features: [...PLAN_FEATURES],
  archived_at: null,
};
type Draft = Omit<Plan, 'id'> & { id: string | null };

export function PlanCatalog({
  plans,
  readOnly,
}: {
  plans: Plan[];
  readOnly: boolean;
}) {
  const t = useTranslations('WorkspacePlans');
  const locale = useLocale();
  const currency = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'INR',
  });
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function mutate(body: Record<string, unknown>) {
    if (busy || readOnly) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/platform-admin/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await res.json().catch(() => null);
      if (!res.ok) {
        setError(result?.error ?? t('saveFailed'));
        return;
      }
      setDraft(null);
      setDeleting(null);
      setNotice(t('saved'));
      router.refresh();
    } catch {
      setError(t('saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void mutate({
      action: 'save',
      id: draft?.id ?? null,
      name: data.get('name'),
      monthly_price_paise: Math.round(Number(data.get('monthly')) * 100),
      yearly_price_paise: Math.round(Number(data.get('yearly')) * 100),
      ...Object.fromEntries(
        PLAN_LIMITS.map((key) => [
          key,
          data.get(key) === '' ? null : Number(data.get(key)),
        ])
      ),
      features: data.getAll('feature'),
    });
  }

  function openDraft(value: Draft) {
    setError('');
    setDraft(value);
  }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">{t('catalog')}</h2>
        <Button
          className="h-11"
          onClick={() => openDraft({ ...empty, id: null })}
        >
          <Plus aria-hidden="true" />
          {t('newPlan')}
        </Button>
      </div>
      {notice && (
        <p role="status" className="mb-3 text-sm">
          {notice}
        </p>
      )}
      {error && !draft && !deleting && (
        <p role="alert" className="text-destructive mb-3 text-sm">
          {error}
        </p>
      )}
      {plans.length ? (
        <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <Card key={plan.id} className="gap-4 p-4 sm:p-5">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold wrap-anywhere">
                  {plan.name}
                </h3>
                {plan.archived_at && (
                  <p className="text-muted-foreground text-sm">
                    {t('archived')}
                  </p>
                )}
              </div>
              <dl className="bg-muted/60 grid grid-cols-2 gap-3 rounded-lg p-3">
                <div>
                  <dt className="text-muted-foreground text-xs">
                    {t('monthly')}
                  </dt>
                  <dd className="mt-1 font-medium tabular-nums">
                    {currency.format(plan.monthly_price_paise / 100)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">
                    {t('yearly')}
                  </dt>
                  <dd className="mt-1 font-medium tabular-nums">
                    {currency.format(plan.yearly_price_paise / 100)}
                  </dd>
                </div>
              </dl>
              <dl className="grid gap-2 text-sm">
                {PLAN_LIMITS.map((key) => (
                  <div key={key} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{t(key)}</dt>
                    <dd className="font-medium tabular-nums">
                      {plan[key] ?? t('unlimited')}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="text-muted-foreground text-sm">
                {plan.features.map((feature) => t(feature)).join(', ') ||
                  t('noExtras')}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="h-10"
                  onClick={() => openDraft(plan)}
                >
                  {t(readOnly ? 'view' : 'edit')}
                </Button>
                {!readOnly && (
                  <>
                    <Button
                      variant="ghost"
                      className="h-10"
                      onClick={() =>
                        openDraft({
                          ...plan,
                          id: null,
                          archived_at: null,
                          name: '',
                        })
                      }
                    >
                      {t('duplicate')}
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-10"
                      disabled={busy}
                      onClick={() =>
                        void mutate({
                          id: plan.id,
                          action: plan.archived_at ? 'restore' : 'archive',
                        })
                      }
                    >
                      {t(plan.archived_at ? 'restore' : 'archive')}
                    </Button>
                    {plan.archived_at && (
                      <Button
                        variant="destructive"
                        className="h-10"
                        onClick={() => {
                          setError('');
                          setDeleting(plan);
                        }}
                      >
                        {t('delete')}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">{t('noPlans')}</p>
      )}

      <Dialog
        open={Boolean(draft)}
        onOpenChange={(open) => {
          if (!open && !busy) setDraft(null);
        }}
      >
        {draft && (
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
            <DialogHeader className="pr-8">
              <DialogTitle>
                {draft.id ? t(readOnly ? 'view' : 'edit') : t('newPlan')}
              </DialogTitle>
              <DialogDescription>
                {t(readOnly ? 'preview' : 'editHelp')}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={save}>
              <fieldset disabled={busy || readOnly} className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="plan-name">{t('name')}</Label>
                  <Input
                    id="plan-name"
                    name="name"
                    defaultValue={draft.name}
                    maxLength={80}
                    required
                    className="h-11"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(['monthly', 'yearly'] as const).map((key) => (
                    <div key={key} className="grid gap-2">
                      <Label htmlFor={`plan-${key}`}>{t(key)} (₹)</Label>
                      <Input
                        id={`plan-${key}`}
                        name={key}
                        type="number"
                        min="0"
                        max="21474836.47"
                        step="0.01"
                        defaultValue={draft[`${key}_price_paise`] / 100}
                        required
                        className="h-11"
                      />
                    </div>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {PLAN_LIMITS.map((key) => (
                    <div key={key} className="grid gap-2">
                      <Label htmlFor={`plan-${key}`}>{t(key)}</Label>
                      <Input
                        id={`plan-${key}`}
                        name={key}
                        type="number"
                        min="0"
                        max="2147483647"
                        placeholder={t('unlimited')}
                        defaultValue={draft[key] ?? ''}
                        className="h-11"
                      />
                    </div>
                  ))}
                </div>
                <fieldset className="grid grid-cols-2 gap-2">
                  <legend className="mb-2 font-medium">{t('features')}</legend>
                  {PLAN_FEATURES.map((feature) => (
                    <label
                      key={feature}
                      className="flex min-h-9 items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        name="feature"
                        value={feature}
                        defaultChecked={draft.features.includes(feature)}
                        className="accent-primary size-4"
                      />
                      {t(feature)}
                    </label>
                  ))}
                </fieldset>
                {!readOnly && (
                  <Button type="submit" className="h-11 justify-self-end">
                    {t(busy ? 'saving' : 'save')}
                  </Button>
                )}
              </fieldset>
              {error && (
                <p role="alert" className="text-destructive mt-2 text-sm">
                  {error}
                </p>
              )}
            </form>
          </DialogContent>
        )}
      </Dialog>
      <Dialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        {deleting && (
          <DialogContent>
            <DialogHeader className="pr-7">
              <DialogTitle>{t('delete')}</DialogTitle>
              <DialogDescription>
                {t('deletePrompt', { name: deleting.name })}
              </DialogDescription>
            </DialogHeader>
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <Button
              variant="destructive"
              className="h-11 justify-self-end"
              disabled={busy}
              onClick={() => void mutate({ id: deleting.id, action: 'delete' })}
            >
              {t('delete')}
            </Button>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
