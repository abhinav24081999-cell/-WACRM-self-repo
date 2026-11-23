'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ProvisionCustomerForm({ readOnly }: { readOnly: boolean }) {
  const t = useTranslations('PlatformAccess');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [credentials, setCredentials] = useState<{
    email: string;
    password: string;
  }>();

  async function createCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly || busy) return;
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError('');

    try {
      const response = await fetch('/api/platform-admin/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: values.get('email'),
          name: values.get('name'),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? t('createFailed'));
        return;
      }
      setCredentials(result);
    } catch {
      setError(t('createFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (credentials) {
    return (
      <div className="flex flex-col gap-4">
        <div role="status">
          <p className="text-foreground font-medium">{t('created')}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('shareCredentials', { email: credentials.email })}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="initial-password">{t('initialPassword')}</Label>
          <Input
            id="initial-password"
            value={credentials.password}
            onFocus={(event) => event.currentTarget.select()}
            className="h-11 font-mono"
            readOnly
          />
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-11 self-start"
          onClick={() => setCredentials(undefined)}
        >
          {t('done')}
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={createCustomer}
      className="flex flex-col gap-4"
      aria-busy={busy}
    >
      {readOnly && (
        <p className="bg-muted text-foreground rounded-lg px-3 py-2 text-sm">
          {t('previewReadOnly')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <fieldset disabled={readOnly || busy} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="customer-name">{t('customerName')}</Label>
          <Input
            id="customer-name"
            name="name"
            autoComplete="off"
            required
            maxLength={100}
            className="h-11"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="customer-email">{t('email')}</Label>
          <Input
            id="customer-email"
            name="email"
            type="email"
            autoComplete="off"
            required
            maxLength={254}
            className="h-11"
          />
        </div>
        <Button
          type="submit"
          disabled={readOnly || busy}
          className="h-11 self-start"
        >
          {busy ? t('creating') : t('createCustomer')}
        </Button>
      </fieldset>
    </form>
  );
}
