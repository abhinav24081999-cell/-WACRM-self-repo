'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
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
  ACCESS_TYPES,
  type AccessType,
  type Payment,
  type WorkspaceCommercial,
} from '@/lib/platform/commercial';

const selectClass =
  'h-11 w-full rounded-lg border border-input bg-background px-3';

export function CommercialWorkspace({
  workspace,
  protectAccess,
}: {
  workspace: WorkspaceCommercial;
  protectAccess: boolean;
}) {
  const t = useTranslations('PlatformCommercial');
  const locale = useLocale();
  const currency = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'INR',
  });
  const number = new Intl.NumberFormat(locale);
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: 'Asia/Kolkata',
  });
  const router = useRouter();
  const sub = workspace.subscription;
  const [access, setAccess] = useState<AccessType>(sub?.access_type ?? 'free');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    error: boolean;
    text: string;
  } | null>(null);
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const paymentAttempt = useRef<{ input: string; id: string } | null>(null);
  const term = access === 'trial' || access === 'paid';

  async function save(body: Record<string, unknown>) {
    if (busy) return false;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/platform-admin/customers/${workspace.id}/commercial`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage({ error: true, text: result?.error ?? t('saveFailed') });
        if (response.status === 409 && body.action === 'subscription_saved')
          router.refresh();
        return false;
      }
      setMessage({ error: false, text: t('saved') });
      router.refresh();
      return true;
    } catch {
      setMessage({ error: true, text: t('saveFailed') });
      return false;
    } finally {
      setBusy(false);
    }
  }

  function saveSubscription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (protectAccess) return;
    const form = new FormData(event.currentTarget);
    void save({
      action: 'subscription_saved',
      access_type: access,
      billing_cycle: access === 'paid' ? form.get('billing_cycle') : null,
      starts_on: form.get('starts_on'),
      ends_on: term ? form.get('ends_on') : null,
      suspended: form.has('suspended'),
      expected_updated_at: sub?.updated_at ?? null,
    });
  }

  async function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const data = {
      action: 'payment_recorded',
      amount_paise: Math.round(Number(form.get('amount')) * 100),
      received_on: form.get('received_on'),
      reference: String(form.get('reference') ?? '').trim(),
    };
    const input = JSON.stringify(data);
    if (paymentAttempt.current?.input !== input)
      paymentAttempt.current = { input, id: crypto.randomUUID() };
    if (await save({ ...data, id: paymentAttempt.current.id })) {
      paymentAttempt.current = null;
      element.reset();
    }
  }

  const messageBox = message && (
    <p
      role={message.error ? 'alert' : 'status'}
      className={`text-sm ${message.error ? 'text-destructive' : 'text-foreground'}`}
    >
      {message.text}
    </p>
  );

  return (
    <>
      <div className="my-6">
        <h1 className="text-3xl font-semibold tracking-tight wrap-anywhere">
          {workspace.name}
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">{t('title')}</p>
      </div>
      <section aria-labelledby="workspace-usage">
        <h2 id="workspace-usage" className="mb-3 text-base font-semibold">
          {t('usage')}
        </h2>
        <dl className="grid grid-cols-3 gap-2 sm:gap-4">
          {(['messages', 'ai', 'capi'] as const).map((key) => (
            <div key={key} className="bg-card rounded-xl border p-3 sm:p-4">
              <dt className="text-muted-foreground text-xs sm:text-sm">
                {t(key)}
              </dt>
              <dd className="mt-2 text-2xl font-semibold tabular-nums">
                {number.format(workspace.usage[key])}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      {!voiding && <div className="mt-4">{messageBox}</div>}
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
        <Card className="gap-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">{t('subscription')}</h2>
            <span className="bg-muted rounded-md border px-2.5 py-1 text-sm">
              {t(`status_${workspace.status}`)}
            </span>
          </div>
          {protectAccess && (
            <p className="text-muted-foreground text-sm">
              {t('ownerProtected')}
            </p>
          )}
          <form key={sub?.updated_at ?? 'new'} onSubmit={saveSubscription}>
            <fieldset disabled={busy || protectAccess} className="grid gap-3">
              <div className="grid gap-2">
                <Label htmlFor="access-type">{t('accessType')}</Label>
                <select
                  id="access-type"
                  className={selectClass}
                  value={access}
                  onChange={(e) => setAccess(e.target.value as AccessType)}
                >
                  {ACCESS_TYPES.map((option) => (
                    <option key={option} value={option}>
                      {t(option)}
                    </option>
                  ))}
                </select>
              </div>
              {access === 'paid' && (
                <div className="grid gap-2">
                  <Label htmlFor="billing-cycle">{t('billingCycle')}</Label>
                  <select
                    id="billing-cycle"
                    name="billing_cycle"
                    defaultValue={sub?.billing_cycle ?? 'monthly'}
                    className={selectClass}
                  >
                    <option value="monthly">{t('monthly')}</option>
                    <option value="yearly">{t('yearly')}</option>
                  </select>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="starts-on">{t('startsOn')}</Label>
                  <Input
                    id="starts-on"
                    name="starts_on"
                    type="date"
                    required
                    defaultValue={sub?.starts_on ?? workspace.today}
                    className="h-11"
                  />
                </div>
                {term && (
                  <div className="grid gap-2">
                    <Label htmlFor="ends-on">{t('endsOn')}</Label>
                    <Input
                      id="ends-on"
                      name="ends_on"
                      type="date"
                      required
                      defaultValue={sub?.ends_on ?? ''}
                      className="h-11"
                    />
                  </div>
                )}
              </div>
              <label className="flex min-h-9 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="suspended"
                  className="accent-primary size-4"
                  defaultChecked={sub?.suspended ?? false}
                />
                {t('suspend')}
              </label>
              <Button type="submit" className="h-11 justify-self-end">
                {t(busy ? 'saving' : 'saveAccess')}
              </Button>
            </fieldset>
          </form>
        </Card>

        <Card className="gap-4 p-4 sm:p-5">
          <div>
            <h2 className="font-semibold">{t('payments')}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{t('manual')}</p>
          </div>
          <form onSubmit={recordPayment}>
            <fieldset disabled={busy} className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="amount">{t('amount')}</Label>
                  <Input
                    id="amount"
                    name="amount"
                    type="number"
                    min="0.01"
                    max="21474836.47"
                    step="0.01"
                    required
                    className="h-11"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="received-on">{t('receivedOn')}</Label>
                  <Input
                    id="received-on"
                    name="received_on"
                    type="date"
                    max={workspace.today}
                    defaultValue={workspace.today}
                    required
                    className="h-11"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="payment-reference">{t('reference')}</Label>
                <Input
                  id="payment-reference"
                  name="reference"
                  maxLength={120}
                  className="h-11"
                />
              </div>
              <Button type="submit" className="h-11 justify-self-end">
                {t(busy ? 'saving' : 'record')}
              </Button>
            </fieldset>
          </form>
          {workspace.payments.length ? (
            <ul className="divide-y border-t">
              {workspace.payments.map((payment) => (
                <li
                  key={payment.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium tabular-nums">
                      {currency.format(payment.amount_paise / 100)}
                    </p>
                    <p className="text-muted-foreground text-sm wrap-anywhere">
                      {date.format(new Date(payment.received_on))}
                      {payment.reference && ` · ${payment.reference}`}
                    </p>
                  </div>
                  {payment.voided_at ? (
                    <span className="text-muted-foreground text-sm">
                      {t('voided')}
                    </span>
                  ) : (
                    <Button
                      variant="outline"
                      className="h-10"
                      disabled={busy}
                      onClick={() => {
                        setMessage(null);
                        setVoiding(payment);
                      }}
                    >
                      {t('void')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground border-t pt-3 text-sm">
              {t('noPayments')}
            </p>
          )}
        </Card>
      </div>
      <Card className="mt-5 gap-3 p-4 sm:p-5">
        <h2 className="font-semibold">{t('activity')}</h2>
        {workspace.audit.length ? (
          <ul className="divide-y">
            {workspace.audit.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-1 py-2 text-sm"
              >
                <span>{t(entry.action)}</span>
                <span className="text-muted-foreground">
                  {entry.actor ?? t('unknownActor')} ·{' '}
                  {date.format(new Date(entry.created_at))}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t('noActivity')}</p>
        )}
      </Card>
      <Dialog
        open={voiding !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setVoiding(null);
            setMessage(null);
          }
        }}
      >
        {voiding && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('void')}</DialogTitle>
              <DialogDescription>
                {t('voidPrompt', {
                  amount: currency.format(voiding.amount_paise / 100),
                })}
              </DialogDescription>
            </DialogHeader>
            {messageBox}
            <Button
              variant="destructive"
              className="h-10 justify-self-end"
              disabled={busy}
              onClick={async () => {
                if (await save({ action: 'payment_voided', id: voiding.id }))
                  setVoiding(null);
              }}
            >
              {t('confirmVoid')}
            </Button>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
