import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { getPlatformAdmin, isSharedPreview } from '@/lib/auth/platform-admin';
import { buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ProvisionCustomerForm } from './provision-customer-form';

export default async function PlatformAdminPage() {
  if (!(await getPlatformAdmin())) redirect('/dashboard');

  const t = await getTranslations('PlatformAccess');
  const readOnly = isSharedPreview();

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <Link href="/dashboard" className={buttonVariants({ variant: 'ghost' })}>
        <ArrowLeft aria-hidden="true" />
        {t('backToCRM')}
      </Link>
      <h1 className="text-foreground mt-6 mb-5 text-2xl font-semibold tracking-tight">
        {t('admin')}
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('createCustomer')}</CardTitle>
          <CardDescription>{t('createDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ProvisionCustomerForm readOnly={readOnly} />
        </CardContent>
      </Card>
    </main>
  );
}
