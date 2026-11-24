import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { getPlatformAdmin, isSharedPreview } from '@/lib/auth/platform-admin';
import { buttonVariants } from '@/components/ui/button';
import { getPlans } from '../plan-data';
import { PlanCatalog } from './plan-catalog';

export default async function PlatformPlansPage() {
  if (!(await getPlatformAdmin())) redirect('/dashboard');
  const t = await getTranslations('WorkspacePlans');
  const preview = isSharedPreview();
  const plans = await getPlans(preview);
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
      <Link
        href="/platform-admin"
        className={buttonVariants({ variant: 'ghost', className: 'h-10' })}
      >
        <ArrowLeft aria-hidden="true" />
        {t('backToAdmin')}
      </Link>
      <h1 className="mt-5 text-3xl font-semibold tracking-tight">
        {t('title')}
      </h1>
      <p className="text-muted-foreground mt-2 mb-5 text-sm">
        {t('description')}
      </p>
      {preview && (
        <p className="bg-muted mb-5 rounded-lg border px-4 py-3 text-sm">
          {t('preview')}
        </p>
      )}
      {plans ? (
        <PlanCatalog plans={plans} readOnly={preview} />
      ) : (
        <p role="alert" className="text-destructive text-sm">
          {t('loadFailed')}
        </p>
      )}
    </main>
  );
}
