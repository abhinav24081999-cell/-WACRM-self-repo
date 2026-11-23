import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  ArrowLeft,
  Building2,
  ChevronLeft,
  ChevronRight,
  ContactRound,
  MessageSquare,
  Plus,
  Search,
  UsersRound,
} from 'lucide-react';
import { getPlatformAdmin, isSharedPreview } from '@/lib/auth/platform-admin';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getDashboardData, WORKSPACE_PAGE_SIZE } from './dashboard-data';
import { ProvisionCustomerForm } from './provision-customer-form';
import { WorkspaceDetails } from './workspace-details';

export default async function PlatformAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; page?: string | string[] }>;
}) {
  if (!(await getPlatformAdmin())) redirect('/dashboard');

  const [t, access, locale, params] = await Promise.all([
    getTranslations('PlatformDashboard'),
    getTranslations('PlatformAccess'),
    getLocale(),
    searchParams,
  ]);
  const search =
    typeof params.q === 'string' ? params.q.trim().slice(0, 120) : '';
  const requestedPage =
    typeof params.page === 'string' ? Number(params.page) : 1;
  const page =
    Number.isSafeInteger(requestedPage) &&
    requestedPage > 0 &&
    requestedPage <= 1_000_000
      ? requestedPage
      : 1;
  const readOnly = isSharedPreview();
  const data = await getDashboardData(
    search,
    (page - 1) * WORKSPACE_PAGE_SIZE,
    readOnly
  );
  const number = new Intl.NumberFormat(locale);
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: 'Asia/Kolkata',
  });
  const activityTime = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });
  const metrics = data
    ? [
        {
          label: t('workspaces'),
          total: data.totals.workspaces,
          icon: Building2,
        },
        { label: t('team'), total: data.totals.team, icon: UsersRound },
        {
          label: t('contacts'),
          total: data.totals.contacts,
          icon: ContactRound,
        },
        {
          label: t('whatsapp'),
          total: data.totals.whatsapp,
          icon: MessageSquare,
        },
      ]
    : [];

  function pageLink(nextPage: number) {
    const query = new URLSearchParams();
    if (search) query.set('q', search);
    if (nextPage > 1) query.set('page', String(nextPage));
    return `/platform-admin${query.size ? `?${query}` : ''}#workspaces`;
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-8 sm:py-10">
      <Link
        href="/dashboard"
        className={buttonVariants({
          variant: 'ghost',
          className: 'text-muted-foreground -ml-2 h-10',
        })}
      >
        <ArrowLeft aria-hidden="true" />
        {access('backToCRM')}
      </Link>
      <div className="mt-5 mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-foreground text-3xl font-semibold tracking-tight">
            {t('title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('description')}
          </p>
        </div>
        <Dialog>
          <DialogTrigger render={<Button className="h-11 px-4" />}>
            <Plus aria-hidden="true" />
            {access('createCustomer')}
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader className="pr-7">
              <DialogTitle>{access('createCustomer')}</DialogTitle>
              <DialogDescription>
                {access('createDescription')}
              </DialogDescription>
            </DialogHeader>
            <ProvisionCustomerForm readOnly={readOnly} />
          </DialogContent>
        </Dialog>
      </div>

      {readOnly && (
        <p className="border-border bg-muted text-foreground mb-5 rounded-lg border px-4 py-3 text-sm">
          {t('previewNotice')}
        </p>
      )}

      {data ? (
        <>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {metrics.map(({ label, total, icon: Icon }) => (
              <div
                key={label}
                className="border-border bg-card min-w-0 rounded-xl border p-3 sm:p-4"
              >
                <dt className="text-muted-foreground flex items-start justify-between gap-2 text-sm">
                  <span>{label}</span>
                  <Icon
                    aria-hidden="true"
                    className="text-primary size-4 shrink-0"
                  />
                </dt>
                <dd className="mt-2 text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
                  {number.format(total)}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-6 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <Card id="workspaces" className="min-w-0 scroll-mt-4 gap-0 py-0">
              <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4 sm:px-5">
                <h2 className="text-base font-semibold">{t('directory')}</h2>
                <form
                  action="/platform-admin#workspaces"
                  method="GET"
                  className="flex w-full flex-wrap gap-2 sm:w-auto"
                >
                  <Input
                    type="search"
                    name="q"
                    aria-label={t('searchWorkspaces')}
                    placeholder={t('searchPlaceholder')}
                    defaultValue={search}
                    maxLength={120}
                    className="h-10 min-w-0 flex-1 sm:w-52"
                  />
                  <Button variant="outline" type="submit" className="h-10">
                    <Search aria-hidden="true" />
                    {t('search')}
                  </Button>
                </form>
              </div>

              {data.workspaces.length ? (
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col" className="px-4 sm:px-5">
                        {t('workspace')}
                      </TableHead>
                      <TableHead
                        scope="col"
                        className="hidden w-20 text-right sm:table-cell"
                      >
                        {t('members')}
                      </TableHead>
                      <TableHead
                        scope="col"
                        className="hidden w-20 text-right md:table-cell"
                      >
                        {t('contacts')}
                      </TableHead>
                      <TableHead
                        scope="col"
                        className="hidden w-24 text-right md:table-cell"
                      >
                        WhatsApp
                      </TableHead>
                      <TableHead scope="col" className="w-20">
                        <span className="sr-only">{t('details')}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.workspaces.map((workspace) => (
                      <TableRow key={workspace.id}>
                        <TableCell className="px-4 py-3 whitespace-normal sm:px-5">
                          <div className="font-medium wrap-anywhere">
                            {workspace.name}
                          </div>
                          <div className="text-muted-foreground mt-0.5 text-xs wrap-anywhere">
                            {workspace.owner_email ?? t('unavailable')}
                          </div>
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums sm:table-cell">
                          {number.format(workspace.members)}
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">
                          {number.format(workspace.contacts)}
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">
                          {number.format(workspace.whatsapp)}
                        </TableCell>
                        <TableCell className="pr-4 text-right">
                          <WorkspaceDetails
                            workspace={workspace}
                            created={date.format(
                              new Date(workspace.created_at)
                            )}
                            readOnly={readOnly}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground px-5 py-8 text-sm">
                  {search || page > 1 ? t('noMatches') : t('noWorkspaces')}
                </p>
              )}

              {(search || page > 1 || data.has_more) && (
                <nav
                  aria-label={t('directory')}
                  className="border-border flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 sm:px-5"
                >
                  {search ? (
                    <Link
                      href="/platform-admin#workspaces"
                      className={buttonVariants({
                        variant: 'ghost',
                        className: 'h-10',
                      })}
                    >
                      {t('clear')}
                    </Link>
                  ) : (
                    <span />
                  )}
                  {(page > 1 || data.has_more) && (
                    <div className="flex flex-wrap items-center gap-2">
                      {page > 1 && (
                        <Link
                          href={pageLink(page - 1)}
                          className={buttonVariants({
                            variant: 'outline',
                            className: 'h-10',
                          })}
                        >
                          <ChevronLeft aria-hidden="true" />
                          {t('previous')}
                        </Link>
                      )}
                      <span className="text-muted-foreground text-xs">
                        {t('pageNumber', { page })}
                      </span>
                      {data.has_more && (
                        <Link
                          href={pageLink(page + 1)}
                          className={buttonVariants({
                            variant: 'outline',
                            className: 'h-10',
                          })}
                        >
                          {t('next')}
                          <ChevronRight aria-hidden="true" />
                        </Link>
                      )}
                    </div>
                  )}
                </nav>
              )}
            </Card>

            <Card className="gap-0 py-0">
              <div className="border-border border-b px-4 py-4 sm:px-5">
                <h2 className="text-base font-semibold">
                  {t('recentActivity')}
                </h2>
              </div>
              {data.activity.length ? (
                <ul className="divide-border divide-y">
                  {data.activity.map((event) => (
                    <li
                      key={`${event.kind}-${event.id}`}
                      className="flex items-start gap-3 px-4 py-3 sm:px-5"
                    >
                      <span className="bg-primary/10 text-primary grid size-8 shrink-0 place-items-center rounded-md">
                        {event.kind === 'created' ? (
                          <Plus aria-hidden="true" className="size-4" />
                        ) : (
                          <Building2 aria-hidden="true" className="size-4" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium wrap-anywhere">
                          {event.kind === 'created'
                            ? t('activityCreated', {
                                name: event.workspace_name ?? t('unavailable'),
                              })
                            : t('activityRenamed', {
                                from: event.old_name ?? t('unavailable'),
                                to: event.workspace_name ?? t('unavailable'),
                              })}
                        </p>
                        <p className="text-muted-foreground mt-1 text-xs wrap-anywhere">
                          {event.actor ?? t('unknownActor')} ·{' '}
                          <time dateTime={event.created_at}>
                            {activityTime.format(new Date(event.created_at))}{' '}
                            IST
                          </time>
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground px-5 py-6 text-sm">
                  {t('noActivity')}
                </p>
              )}
            </Card>
          </div>
        </>
      ) : (
        <p
          role="alert"
          className="border-border bg-card text-destructive rounded-lg border px-4 py-4 text-sm"
        >
          {t('loadFailed')}
        </p>
      )}
    </main>
  );
}
