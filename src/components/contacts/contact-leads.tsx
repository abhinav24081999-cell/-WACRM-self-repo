import { useEffect, useId, useState, type FormEvent } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCan } from '@/hooks/use-can';
import { createClient } from '@/lib/supabase/client';

const statuses = [
  'new', 'interested', 'not_interested', 'busy', 'no_response',
  'in_process', 'qualified', 'converted', 'completed', 'junk',
] as const;
const sources = [
  'manual', 'whatsapp', 'instagram_dm', 'messenger', 'meta_instant_form',
  'google_lead_form', 'website_form', 'other',
] as const;
const attributionFields = [
  'external_lead_id', 'form_id', 'campaign_id', 'campaign_name',
  'ad_group_id', 'ad_group_name', 'ad_id', 'ad_name', 'ctwa_clid',
  'gclid', 'gbraid', 'wbraid', 'utm_source', 'utm_medium', 'utm_campaign',
  'utm_content', 'utm_term', 'referral_url', 'referral_source', 'referral_type',
  'referral_ref', 'referral_headline', 'meta_page_id',
] as const;

type Status = (typeof statuses)[number];

interface Lead {
  id: string;
  title: string;
  status: Status;
  source: (typeof sources)[number];
  source_detail: string | null;
  ads_platform: 'meta' | 'google' | null;
  attribution: Record<string, unknown>;
  form_answers: { name: string; values: string[] }[];
  meta_event_key: string | null;
  updated_at: string;
}

interface StatusChange {
  id: number;
  previous_status: Status | null;
  status: Status;
  changed_by_name: string | null;
  changed_at: string;
}

interface ContactScope {
  accountId: string;
  contactId: string;
}

const listPageSize = 25;
const selectClass = 'h-8 w-full rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-ring';
const leadColumns = 'id,title,status,source,source_detail,ads_platform,attribution,form_answers,meta_event_key,updated_at';

export function ContactLeads({ accountId, contactId }: ContactScope) {
  const t = useTranslations('Contacts.leads');
  const canEdit = useCan('send-messages');
  const [page, setPage] = useState(0);
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Lead | 'new' | null>(null);

  useEffect(() => {
    let active = true;
    const start = page * listPageSize;
    void createClient().from('leads')
      .select(leadColumns)
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .order('id')
      .range(start, start + listPageSize)
      .then(({ data, error }) => {
        if (!active) return;
        setError(Boolean(error));
        setLeads(data as Lead[] | null);
      });
    return () => { active = false; };
  }, [accountId, contactId, page, revision]);

  function loadPage(nextPage: number) {
    setLeads(null);
    setError(false);
    setPage(nextPage);
    setRevision((value) => value + 1);
  }

  if (selected !== null) {
    const lead = selected === 'new' ? null : selected;
    return (
      <div className="space-y-4">
        <LeadForm
          key={`editor:${lead?.updated_at ?? 'new'}`}
          accountId={accountId}
          contactId={contactId}
          lead={lead}
          canEdit={canEdit}
          onSaved={setSelected}
          onBack={() => {
            setSelected(null);
            loadPage(page);
          }}
        />
        {!!lead?.form_answers?.length && (
          <details className="rounded-lg border p-3" open>
            <summary className="cursor-pointer font-medium">{t('formAnswers')}</summary>
            <dl className="mt-3 space-y-2">
              {lead.form_answers.map(({ name, values }) => (
                <div key={name} className="break-words">
                  <dt className="text-sm font-medium">{name.replaceAll('_', ' ')}</dt>
                  {values.map((value, index) => <dd className="whitespace-pre-wrap text-sm" key={index}>{value}</dd>)}
                </div>
              ))}
            </dl>
          </details>
        )}
        {lead && <LeadHistory key={`history:${lead.updated_at}`} leadId={lead.id} />}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {canEdit && leads && (
        <Button size="sm" onClick={() => setSelected('new')}><Plus />{t('add')}</Button>
      )}
      {error ? (
        <div role="alert" className="space-y-2">
          <p>{t('loadFailed')}</p>
          <Button size="sm" variant="outline" onClick={() => loadPage(page)}>{t('retry')}</Button>
        </div>
      ) : !leads ? (
        <p role="status" className="text-muted-foreground">{t('loading')}</p>
      ) : leads.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="space-y-2">
          {leads.slice(0, listPageSize).map((lead) => (
            <li key={lead.id}>
              <button
                type="button"
                className="w-full rounded-lg border p-3 text-left hover:bg-muted focus-visible:outline-ring"
                onClick={() => setSelected(lead)}
              >
                <span className="block break-words font-medium">{lead.title}</span>
                <span className="text-xs text-muted-foreground">
                  {lead.source === 'meta_instant_form' && lead.source_detail
                    ? lead.source_detail
                    : t(`sources.${lead.source}`)} · {t(`statuses.${lead.status}`)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {leads && <PageButtons page={page} hasNext={leads.length > listPageSize} onPage={loadPage} />}
    </div>
  );
}

function LeadForm({ accountId, contactId, lead, canEdit, onSaved, onBack }: ContactScope & {
  lead: Lead | null;
  canEdit: boolean;
  onSaved: (lead: Lead) => void;
  onBack: () => void;
}) {
  const t = useTranslations('Contacts.leads');
  const fieldId = useId();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || saving) return;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim();
    const title = value('title');
    if (!title) return setSaveError(t('titleRequired'));

    const attribution = { ...lead?.attribution };
    for (const field of attributionFields) {
      const input = value(field);
      if (input) attribution[field] = input;
      else if (typeof attribution[field] === 'string') delete attribution[field];
    }

    const changes = {
      title, attribution,
      status: value('status'),
      source: value('source'),
      source_detail: value('source_detail') || null,
      ads_platform: value('ads_platform') || null,
    };
    setSaving(true);
    setSaveError('');
    const table = createClient().from('leads');
    const write = lead
      ? table.update(changes).eq('id', lead.id).eq('account_id', accountId).eq('contact_id', contactId)
        .eq('updated_at', lead.updated_at)
      : table.insert({ ...changes, account_id: accountId, contact_id: contactId });
    const { data, error } = await write.select(leadColumns).maybeSingle();
    setSaving(false);
    if (error) return setSaveError(t('saveFailed'));
    if (!data) return setSaveError(t('stale'));
    toast.success(t('saved'));
    onSaved(data as Lead);
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={saving}>{t('back')}</Button>
      <fieldset disabled={!canEdit || saving} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor={`${fieldId}-title`}>{t('title')}</Label>
          <Input id={`${fieldId}-title`} name="title" defaultValue={lead?.title} maxLength={120} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0 space-y-1">
            <Label htmlFor={`${fieldId}-status`}>{t('status')}</Label>
            <select id={`${fieldId}-status`} name="status" className={selectClass} defaultValue={lead?.status ?? 'new'}>
              {statuses.map((status) => <option key={status} value={status}>{t(`statuses.${status}`)}</option>)}
            </select>
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor={`${fieldId}-source`}>{t('source')}</Label>
            <select id={`${fieldId}-source`} name="source" className={selectClass} defaultValue={lead?.source ?? 'manual'}>
              {sources.map((source) => <option key={source} value={source}>{t(`sources.${source}`)}</option>)}
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${fieldId}-source-detail`}>{t('sourceDetail')}</Label>
          <Input id={`${fieldId}-source-detail`} name="source_detail" defaultValue={lead?.source_detail ?? ''} maxLength={255} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${fieldId}-platform`}>{t('adsPlatform')}</Label>
          <select id={`${fieldId}-platform`} name="ads_platform" className={selectClass} defaultValue={lead?.ads_platform ?? ''}>
            <option value="">{t('unspecified')}</option>
            <option value="meta">Meta Ads</option>
            <option value="google">Google Ads</option>
          </select>
        </div>
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer font-medium">{t('attribution')}</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {attributionFields.map((field) => {
              const initial = lead?.attribution[field];
              return (
                <div key={field} className="min-w-0 space-y-1">
                  <Label htmlFor={`${fieldId}-${field}`}>{t(`fields.${field}`)}</Label>
                  <Input
                    id={`${fieldId}-${field}`}
                    name={field}
                    defaultValue={typeof initial === 'string' ? initial : ''}
                    readOnly={field === 'external_lead_id' && lead?.meta_event_key?.startsWith('meta_instant_form:')}
                    maxLength={field === 'referral_url' ? 2048 : 512}
                  />
                </div>
              );
            })}
          </div>
        </details>
      </fieldset>
      {saveError && <p role="alert" className="text-destructive">{saveError}</p>}
      {canEdit && <Button type="submit" size="sm" disabled={saving}>{t(saving ? 'saving' : 'save')}</Button>}
    </form>
  );
}

function LeadHistory({ leadId }: { leadId: string }) {
  const t = useTranslations('Contacts.leads');
  const format = useFormatter();
  const [page, setPage] = useState(0);
  const [history, setHistory] = useState<StatusChange[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const start = page * listPageSize;
    void createClient().from('lead_status_history')
      .select('id,previous_status,status,changed_by_name,changed_at')
      .eq('lead_id', leadId)
      .order('id', { ascending: false })
      .range(start, start + listPageSize)
      .then(({ data, error }) => {
        if (!active) return;
        setError(Boolean(error));
        setHistory(data as StatusChange[] | null);
      });
    return () => { active = false; };
  }, [leadId, page]);

  return (
    <section className="space-y-2 border-t pt-3">
      <h3 className="font-medium">{t('history')}</h3>
      {error ? <p role="alert">{t('historyFailed')}</p> : !history ? (
        <p role="status" className="text-muted-foreground">{t('loading')}</p>
      ) : (
        <>
          <ul className="space-y-2">
            {history.slice(0, listPageSize).map((change) => (
              <li key={change.id} className="rounded-lg border p-2">
                <p>
                  {change.previous_status ? t('transition', {
                    from: t(`statuses.${change.previous_status}`),
                    to: t(`statuses.${change.status}`),
                  }) : t('initialStatus', { status: t(`statuses.${change.status}`) })}
                </p>
                <p className="text-xs text-muted-foreground">
                  <time dateTime={change.changed_at}>{format.dateTime(new Date(change.changed_at), {
                    dateStyle: 'medium', timeStyle: 'short',
                  })}</time>
                  {change.changed_by_name && <> · {change.changed_by_name}</>}
                </p>
              </li>
            ))}
          </ul>
          <PageButtons page={page} hasNext={history.length > listPageSize} onPage={(next) => {
            setHistory(null);
            setPage(next);
          }} />
        </>
      )}
    </section>
  );
}

function PageButtons({ page, hasNext, onPage }: {
  page: number;
  hasNext: boolean;
  onPage: (page: number) => void;
}) {
  const t = useTranslations('Contacts.leads');
  if (page === 0 && !hasNext) return null;
  return (
    <div className="flex gap-2">
      <Button type="button" size="sm" variant="outline" disabled={page === 0} onClick={() => onPage(page - 1)}>
        {t('previous')}
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={!hasNext} onClick={() => onPage(page + 1)}>
        {t('next')}
      </Button>
    </div>
  );
}
