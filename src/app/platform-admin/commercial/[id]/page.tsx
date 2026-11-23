import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { getPlatformAdmin, isSharedPreview } from '@/lib/auth/platform-admin';
import { isUuid } from '@/lib/api/v1/pagination';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import type { WorkspaceCommercial } from '@/lib/platform/commercial';
import { CommercialWorkspace } from './workspace';

export default async function CommercialPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await getPlatformAdmin();
  if (!actor) redirect('/dashboard');
  if (isSharedPreview()) redirect('/platform-admin');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const t = await getTranslations('PlatformCommercial');
  const { data, error } = await supabaseAdmin().rpc(
    'platform_commercial_snapshot',
    { p_account_id: id }
  );
  if (!error && !data) notFound();
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
      <Link
        href="/platform-admin#workspaces"
        className={buttonVariants({ variant: 'ghost', className: 'h-10' })}
      >
        <ArrowLeft aria-hidden="true" />
        {t('back')}
      </Link>
      {error ? (
        <p role="alert" className="text-destructive mt-6 text-sm">
          {t('loadFailed')}
        </p>
      ) : (
        <CommercialWorkspace
          workspace={data as WorkspaceCommercial}
          protectAccess={data.owner_id === actor.id}
        />
      )}
    </main>
  );
}
