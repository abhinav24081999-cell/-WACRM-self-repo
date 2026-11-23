'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Workspace } from './dashboard-data';

export function WorkspaceDetails({
  workspace,
  created,
  readOnly,
}: {
  workspace: Workspace;
  created: string;
  readOnly: boolean;
}) {
  const t = useTranslations('PlatformDashboard');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || readOnly) return;
    const name = new FormData(event.currentTarget).get('workspace-name');
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/platform-admin/customers/${workspace.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, expectedName: workspace.name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? t('renameFailed'));
        if (res.status === 409 || res.status === 404) router.refresh();
        return;
      }
      toast.success(t('saved'));
      setOpen(false);
      router.refresh();
    } catch {
      setError(t('renameFailed'));
    } finally {
      setBusy(false);
    }
  }

  const details = [
    [t('ownerEmail'), workspace.owner_email ?? t('unavailable')],
    [t('createdOn'), created],
    [t('members'), workspace.members],
    [t('contacts'), workspace.contacts],
    [t('whatsapp'), workspace.whatsapp],
  ] as const;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (next) setError('');
        setOpen(next);
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            className="h-10 min-w-12"
            aria-label={t('viewWorkspace', { name: workspace.name })}
          />
        }
      >
        {t('view')}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pr-7">
          <DialogTitle className="text-lg wrap-anywhere">
            {workspace.name}
          </DialogTitle>
          <DialogDescription>{t('workspaceDetails')}</DialogDescription>
        </DialogHeader>
        <dl className="bg-muted/60 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg p-3">
          {details.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="mt-1 font-medium wrap-anywhere tabular-nums">
                {value}
              </dd>
            </div>
          ))}
        </dl>
        {!readOnly && (
          <form
            onSubmit={rename}
            className="flex flex-col gap-3"
            aria-busy={busy}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor={`name-${workspace.id}`}>
                {t('workspaceName')}
              </Label>
              <Input
                id={`name-${workspace.id}`}
                name="workspace-name"
                key={workspace.name}
                defaultValue={workspace.name}
                maxLength={100}
                required
                disabled={busy}
                className="h-11"
              />
            </div>
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="h-11 self-end" disabled={busy}>
              {busy ? t('saving') : t('save')}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
