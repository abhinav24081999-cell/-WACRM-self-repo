'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ROLE_ACTIONS, type WorkspaceAction } from '@/lib/auth/workspace-plan';

const roles = ['admin', 'agent'] as const;
type Settings = Record<(typeof roles)[number], WorkspaceAction[]> & {
  readOnly: boolean;
};

export function RolePermissions() {
  const t = useTranslations('WorkspacePlans');
  const roleText = useTranslations('Settings.roles');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    async function load() {
      try {
        const res = await fetch('/api/account/role-permissions', {
          signal: ctrl.signal,
          cache: 'no-store',
        });
        if (!res.ok) throw new Error('Role permissions unavailable');
        setSettings(await res.json());
      } catch {
        if (!ctrl.signal.aborted) setError(t('loadFailed'));
      }
    }
    void load();
    return () => ctrl.abort();
  }, [t]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !settings || settings.readOnly) return;
    const data = new FormData(event.currentTarget);
    const changes = Object.fromEntries(
      roles.map((role) => [
        role,
        ROLE_ACTIONS.filter((action) => !data.has(`${role}-${action}`)),
      ])
    );
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const res = await fetch('/api/account/role-permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      });
      if (!res.ok) throw new Error('Role permissions could not be saved');
      setSaved(true);
    } catch {
      setError(t('saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="gap-3 p-4 sm:p-5">
      <div>
        <h2 className="font-semibold">{t('rolePermissions')}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{t('roleHelp')}</p>
      </div>
      {settings?.readOnly && (
        <p className="bg-muted rounded-md p-3 text-sm">{t('preview')}</p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {settings ? (
        <form onSubmit={save} onChange={() => setSaved(false)} aria-busy={busy}>
          <fieldset disabled={busy || settings.readOnly} className="grid gap-3">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 sm:gap-x-5">
              <span />
              {roles.map((role) => (
                <span
                  key={role}
                  className="min-w-14 text-center text-sm font-medium"
                >
                  {roleText(role)}
                </span>
              ))}
              {ROLE_ACTIONS.map((action) => (
                <div
                  key={action}
                  className="col-span-3 grid grid-cols-subgrid items-center border-t py-1"
                >
                  <span className="text-sm">{t(`role_${action}`)}</span>
                  {roles.map((role) => (
                    <label
                      key={role}
                      className="flex min-h-11 min-w-14 cursor-pointer items-center justify-center"
                    >
                      <input
                        type="checkbox"
                        name={`${role}-${action}`}
                        aria-label={`${roleText(role)} · ${t(`role_${action}`)}`}
                        className="accent-primary size-4"
                        defaultChecked={!settings[role].includes(action)}
                      />
                    </label>
                  ))}
                </div>
              ))}
            </div>
            {!settings.readOnly && (
              <Button type="submit" className="h-11 justify-self-end">
                {t(busy ? 'saving' : 'save')}
              </Button>
            )}
          </fieldset>
          {saved && (
            <p role="status" className="mt-2 text-sm">
              {t('saved')}
            </p>
          )}
        </form>
      ) : (
        !error && (
          <p role="status" className="text-muted-foreground text-sm">
            {t('loading')}
          </p>
        )
      )}
    </Card>
  );
}
