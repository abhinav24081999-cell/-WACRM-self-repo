'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { createClient } from '@/lib/supabase/client';

const sources = ['meta_instant_form', 'whatsapp', 'instagram_dm', 'messenger', 'google_lead_form', 'website_form'] as const;
type Source = (typeof sources)[number];
type Stage = 'new' | 'qualified' | 'converted';
type Delivery = 'manual' | 'automatic' | 'off';
type Rule = { source: Source; stage: Stage; destination: string; delivery: Delivery; test_mode: boolean };
type Event = Omit<Rule, 'delivery'> & { id: string; event_time: string; state: string; attempts: number; reason: string | null; response_id: string | null; provider_target: string | null; http_status: number | null; sent_at: string | null };
type Connection = {
  available: boolean; sources: Source[]; live: boolean;
  metaTestSources: Source[];
  metaIntake: { callbackConfigured: boolean; deliveryConfigured: boolean };
};

const initialRule: Rule = { source: 'meta_instant_form', stage: 'qualified', destination: '', delivery: 'manual', test_mode: true };
const selectClass = 'h-8 w-full rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-ring';

function isGoogle(source: Source) {
  return source === 'google_lead_form' || source === 'website_form';
}

export function ConversionFeedbackSettings() {
  const t = useTranslations('ConversionFeedback');
  const lead = useTranslations('Contacts.leads');
  const format = useFormatter();
  const { accountId } = useAuth();
  const canEdit = useCan('edit-settings');
  const [rule, setRule] = useState<Rule>(initialRule);
  const [rules, setRules] = useState<Rule[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [status, setStatus] = useState('');
  const [formId, setFormId] = useState('');
  const [formCursor, setFormCursor] = useState('');
  const [importStatus, setImportStatus] = useState('');

  async function importForm(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch('/api/meta/leads/backfill', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formId: formId.trim(), ...(formCursor && { after: formCursor }) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setFormCursor(result.failed ? formCursor : result.next ?? '');
      setImportStatus(`${result.scanned} read · ${result.imported} processed · ${result.existing} already in WACRM · ${result.failed} failed.${
        result.failed ? ' Retry the same page to recover failed leads.' : result.next ? ' More leads are available.' : ' End of form results.'}`);
      setRevision(value => value + 1);
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : 'Meta form import failed.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!accountId || !canEdit) return;
    let active = true;
    const db = createClient();
    void Promise.all([
      db.from('conversion_feedback_rules').select('source,stage,destination,delivery,test_mode').eq('account_id', accountId).order('source'),
      db.from('conversion_feedback_events').select('id,source,stage,destination,test_mode,event_time,state,attempts,reason,response_id,provider_target,http_status,sent_at')
        .eq('account_id', accountId).order('created_at', { ascending: false }).limit(25),
      fetch('/api/conversion-feedback', { cache: 'no-store' }).then(response => response.ok ? response.json() : null),
    ]).then(([mapping, log, setup]) => {
      if (!active) return;
      setRules(mapping.data as Rule[] ?? []);
      setEvents(log.data as Event[] ?? []);
      setConnection(setup);
      setLoadError(Boolean(mapping.error || log.error));
    }).catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [accountId, canEdit, revision]);

  const messaging = rule.source !== 'meta_instant_form' && !isGoogle(rule.source);
  const stages: Stage[] = isGoogle(rule.source) ? ['qualified', 'converted'] : messaging ? ['new', 'qualified'] : ['new', 'qualified', 'converted'];

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!accountId || busy) return;
    const destination = messaging ? (rule.stage === 'new' ? 'LeadSubmitted' : 'QualifiedLead') : rule.destination.trim();
    const delivery = messaging && rule.stage === 'new' && rule.delivery === 'automatic' ? 'manual' : rule.delivery;
    setBusy(true);
    try {
      const response = await fetch('/api/conversion-feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', rule: { ...rule, destination, delivery } }),
      });
      setStatus(t(response.ok ? 'saved' : 'saveError'));
      if (response.ok) setRevision(value => value + 1);
    } catch { setStatus(t('saveError')); }
    finally { setBusy(false); }
  }

  async function run(eventId?: string) {
    setBusy(true);
    try {
      const response = await fetch('/api/conversion-feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventId ? { action: 'retry', eventId } : { action: 'run' }),
      });
      if (!response.ok) { setStatus(t('runError')); return; }
      const summary = await response.json();
      setStatus(eventId ? t('queued') : t('processed', { count: summary.processed }));
      setRevision(value => value + 1);
    } catch { setStatus(t('runError')); }
    finally { setBusy(false); }
  }

  if (!canEdit) return <p className="text-sm text-muted-foreground">{t('adminOnly')}</p>;

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t(connection?.live ? 'liveEnabled' : 'testOnly')}</p>
        {connection?.sources.length ? <p className="text-sm">{t('configured', {
          sources: format.list(connection.sources.map(source => lead(`sources.${source}`)), { type: 'conjunction' }),
        })}</p> : <p className="text-sm text-muted-foreground">{t('connectionNeeded')}</p>}
        {connection?.metaIntake && <ul className="space-y-1 text-sm text-muted-foreground">
          <li>Meta Page webhook verification token {connection.metaIntake.callbackConfigured ? 'configured' : 'needed'}</li>
          <li>Meta form delivery credentials {connection.metaIntake.deliveryConfigured ? 'configured' : 'needed'}</li>
          <li>Meta Instant Forms CAPI {connection.metaTestSources.includes('meta_instant_form') ? 'configured for Test Events' : 'needs a dataset, token and Test Events code'}</li>
        </ul>}
        {loadError && <p role="alert" className="text-sm text-destructive">{t('loadError')}</p>}
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="conversion-source">{t('source')}</Label>
            <select id="conversion-source" className={selectClass} value={rule.source}
              onChange={event => setRule({ ...rule, source: event.target.value as Source, stage: 'qualified', destination: '' })}>
              {sources.map(source => <option key={source} value={source}>{lead(`sources.${source}`)}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="conversion-stage">{t('stage')}</Label>
            <select id="conversion-stage" className={selectClass} value={rule.stage}
              onChange={event => {
                const stage = event.target.value as Stage;
                setRule({ ...rule, stage, delivery: messaging && stage === 'new' && rule.delivery === 'automatic' ? 'manual' : rule.delivery });
              }}>
              {stages.map(value => <option key={value} value={value}>{lead(`statuses.${value}`)}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="conversion-destination">{t(isGoogle(rule.source) ? 'googleAction' : 'metaEvent')}</Label>
            <Input id="conversion-destination" required readOnly={messaging}
              pattern={isGoogle(rule.source) ? '[1-9][0-9]{0,19}' : '[A-Za-z][A-Za-z0-9_ ]{0,79}'}
              value={messaging ? (rule.stage === 'new' ? 'LeadSubmitted' : 'QualifiedLead') : rule.destination}
              onChange={event => setRule({ ...rule, destination: event.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="conversion-delivery">{t('delivery')}</Label>
            <select id="conversion-delivery" className={selectClass} value={rule.delivery}
              onChange={event => setRule({ ...rule, delivery: event.target.value as Delivery })}>
              {(['manual', 'automatic', 'off'] as const).map(value => <option key={value} value={value}
                disabled={value === 'automatic' && messaging && rule.stage === 'new'}>{t(value)}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={rule.test_mode} disabled={!connection?.live && rule.test_mode}
              onChange={event => setRule({ ...rule, test_mode: event.target.checked })} /> {t('testMode')}
          </label>
          <div><Button type="submit" disabled={busy || loadError || !connection?.available}>{t('save')}</Button></div>
        </form>
        {!!rules.length && <ul className="grid gap-2 sm:grid-cols-2">
          {rules.map(item => <li key={`${item.source}:${item.stage}`}>
            <button type="button" className="w-full rounded-lg border p-3 text-left text-sm hover:bg-muted"
              onClick={() => setRule(item)}>
              {lead(`sources.${item.source}`)} · {lead(`statuses.${item.stage}`)}
              <span className="block text-xs text-muted-foreground">{item.destination} · {t(item.delivery)} · {t(item.test_mode ? 'testMode' : 'liveMode')}</span>
            </button>
          </li>)}
        </ul>}
        {status && <p className="text-sm" role="status">{status}</p>}
      </section>
      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="text-lg font-semibold">Recover Meta Instant Form leads</h2>
        <p className="text-sm text-muted-foreground">Import missed leads from the connected Facebook Page in batches of 20.</p>
        <form onSubmit={importForm} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="meta-backfill-form">Instant Form ID</Label>
            <Input id="meta-backfill-form" inputMode="numeric" pattern="[0-9]{1,40}" required value={formId}
              onChange={event => { setFormId(event.target.value); setFormCursor(''); setImportStatus(''); }} />
          </div>
          <Button type="submit" disabled={busy}>{formCursor ? 'Import next batch' : 'Import leads'}</Button>
        </form>
        {importStatus && <p className="text-sm" role="status">{importStatus}</p>}
      </section>
      <section className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t('history')}</h2>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setRevision(value => value + 1)}>{t('refresh')}</Button>
            <Button type="button" size="sm" onClick={() => void run()} disabled={busy || !connection?.available}>{t('process')}</Button>
          </div>
        </div>
        {!events.length && <p className="text-sm text-muted-foreground">{t('empty')}</p>}
        {!!events.length && <ul className="divide-y">
          {events.map(item => <li key={item.id} className="space-y-1 py-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <span>{lead(`sources.${item.source}`)} · {lead(`statuses.${item.stage}`)}</span>
              <strong>{item.state === 'needs_review' ? 'Needs review' : t(`states.${item.state}`)}</strong>
            </div>
            <div className="text-xs text-muted-foreground">{item.destination} · {t(item.test_mode ? 'testMode' : 'liveMode')} · {format.dateTime(new Date(item.event_time), 'short')} · {t('attempts', { count: item.attempts })}</div>
            {item.reason && <div className="break-all text-xs text-muted-foreground">{item.reason}</div>}
            {item.response_id && <div className="break-all text-xs text-muted-foreground">{item.response_id}</div>}
            {item.provider_target && <div className="text-xs text-muted-foreground">Destination {item.provider_target}
              {item.http_status && ` · HTTP ${item.http_status}`}
              {item.sent_at && ` · Sent ${format.dateTime(new Date(item.sent_at), 'short')}`}</div>}
            {item.state === 'failed' && <Button type="button" size="sm" variant="outline" disabled={busy || !connection?.available}
              onClick={() => void run(item.id)}>{lead('retry')}</Button>}
          </li>)}
        </ul>}
      </section>
    </div>
  );
}
