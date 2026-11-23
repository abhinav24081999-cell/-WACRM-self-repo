'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  PLAN_FEATURES,
  PLAN_LIMITS,
  type Plan,
  type WorkspacePlan,
} from '@/lib/auth/workspace-plan';

export function WorkspacePlanForm({
  accountId,
  plans,
  assignment,
  readOnly,
}: {
  accountId: string;
  plans: Plan[];
  assignment: WorkspacePlan | undefined;
  readOnly: boolean;
}) {
  const t = useTranslations('WorkspacePlans');
  const router = useRouter();
  const [planId, setPlanId] = useState(assignment?.plan_id ?? '');
  const [overrideFeatures, setOverrideFeatures] = useState(
    assignment?.features != null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const plan = plans.find((item) => item.id === planId);
  const current = assignment?.plan_id === planId ? assignment : undefined;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly || busy) return;
    const form = new FormData(event.currentTarget);
    setError('');
    setSaved(false);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/platform-admin/customers/${accountId}/plan`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plan_id: planId || null,
            ...Object.fromEntries(
              PLAN_LIMITS.map((key) => [
                key,
                form.get(key) ? Number(form.get(key)) : null,
              ])
            ),
            features:
              planId && overrideFeatures ? form.getAll('feature') : null,
          }),
        }
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? t('saveFailed'));
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError(t('saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="border-border border-t pt-4">
      <fieldset disabled={readOnly || busy} className="grid gap-3">
        <legend className="mb-2 font-semibold">{t('assignment')}</legend>
        <Label htmlFor={`plan-${accountId}`}>{t('selectPlan')}</Label>
        <select
          id={`plan-${accountId}`}
          value={planId}
          onChange={(event) => {
            const id = event.target.value;
            setPlanId(id);
            setOverrideFeatures(
              id === assignment?.plan_id && assignment.features != null
            );
            setSaved(false);
          }}
          className="border-input bg-background h-11 w-full rounded-lg border px-3 text-sm"
        >
          <option value="">{t('unrestricted')}</option>
          {plans
            .filter(
              (item) => !item.archived_at || item.id === assignment?.plan_id
            )
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.archived_at ? ` (${t('archived')})` : ''}
              </option>
            ))}
        </select>
        {plan && (
          <div key={planId} className="grid gap-3">
            <p className="text-muted-foreground text-sm">{t('overrideHelp')}</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {PLAN_LIMITS.map((key) => (
                <div key={key} className="grid gap-1">
                  <Label htmlFor={`override-${accountId}-${key}`}>
                    {t(key)}
                  </Label>
                  <Input
                    id={`override-${accountId}-${key}`}
                    name={key}
                    type="number"
                    min="0"
                    max="2147483647"
                    defaultValue={current?.[key] ?? ''}
                    placeholder={String(plan[key] ?? t('unlimited'))}
                    className="h-10"
                  />
                </div>
              ))}
            </div>
            <label className="flex min-h-9 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={overrideFeatures}
                onChange={(e) => setOverrideFeatures(e.target.checked)}
                className="accent-primary size-4"
              />
              {t('overrideFeatures')}
            </label>
            {overrideFeatures && (
              <fieldset className="grid grid-cols-2 gap-1">
                <legend className="mb-1 text-sm font-medium">
                  {t('features')}
                </legend>
                {PLAN_FEATURES.map((feature) => (
                  <label
                    key={feature}
                    className="flex min-h-9 items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      name="feature"
                      value={feature}
                      defaultChecked={(
                        current?.features ?? plan.features
                      ).includes(feature)}
                      className="accent-primary size-4"
                    />
                    {t(feature)}
                  </label>
                ))}
              </fieldset>
            )}
          </div>
        )}
        {!readOnly && (
          <Button type="submit" className="h-10 justify-self-end">
            {t(busy ? 'saving' : 'saveAssignment')}
          </Button>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="mt-2 text-sm">
          {t('saved')}
        </p>
      )}
    </form>
  );
}
