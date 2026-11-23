'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingsPanelHead } from './settings-panel-head';
import {
  DEFAULT_WEBHOOK_FIELDS,
  WEBHOOK_PAYLOAD_FIELDS,
} from '@/lib/webhooks/payload';
import { WEBHOOK_EVENTS, type WebhookEvent } from '@/lib/webhooks/events';
import type { ApiWebhookEndpoint } from '@/lib/webhooks/endpoints';
import type { WebhookDelivery } from '@/lib/webhooks/deliver';

const PATH = '/api/account/webhooks';

const EVENT_LABELS: Record<WebhookEvent, string> = {
  'conversation.created': 'Conversation opened',
  'message.received': 'New WhatsApp message',
  'message.status_updated': 'WhatsApp message status changed',
};

const DELIVERY_LABELS = {
  delivered: 'Delivered',
  http_error: 'Destination rejected the request',
  network_error: 'Destination unreachable or timed out',
  blocked_destination: 'Destination is blocked',
  secret_error: 'Signing secret unavailable',
} as const;

type Endpoint = ApiWebhookEndpoint & {
  name: string | null;
  payload_fields: string[] | null;
};
type WebhookForm = {
  id?: string;
  name: string;
  url: string;
  events: WebhookEvent[];
  payloadFields: string[] | null;
};
const EMPTY_FORM: WebhookForm = {
  name: '',
  url: '',
  events: [],
  payloadFields: [...DEFAULT_WEBHOOK_FIELDS],
};

function showDate(date: string) {
  return new Date(date).toLocaleString();
}

async function request(path: string, body?: object, signal?: AbortSignal) {
  const response = await fetch(
    path,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        }
      : { cache: 'no-store', signal }
  );
  const data = await response.json().catch(() => null);
  if (!response.ok || !data)
    throw new Error(data?.error ?? 'The request could not be completed.');
  return data;
}

function toggleValue<T>(values: T[], value: T) {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

export function WebhookManager() {
  const { accountId, accountRole, profileLoading } = useAuth();
  if (profileLoading) return <p role="status">Loading webhooks…</p>;
  if (!accountRole || !canEditSettings(accountRole))
    return <p>Only workspace owners and admins can manage webhooks.</p>;
  return <WebhookManagerPanel key={accountId} />;
}

function WebhookManagerPanel() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [form, setForm] = useState<WebhookForm | null>(null);
  const [secret, setSecret] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    error?: boolean;
  } | null>(null);
  const [history, setHistory] = useState<{
    id: string;
    rows: WebhookDelivery[];
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    request(PATH, undefined, controller.signal)
      .then((data) => setEndpoints(data.endpoints))
      .catch((error: Error) => {
        if (!controller.signal.aborted)
          setFeedback({ message: error.message, error: true });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setFeedback(null);
    try {
      await action();
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : 'The request failed.',
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    const data = await request(PATH);
    setEndpoints(data.endpoints);
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    void run(async () => {
      const data = await request(PATH, { action: 'save', ...form });
      setSecret(data.secret ?? '');
      setForm(null);
      await refresh();
      setFeedback({
        message: form.id
          ? 'Webhook saved.'
          : 'Webhook created and paused. Send a test before enabling it.',
      });
    });
  }

  function manage(
    id: string,
    action: 'test' | 'toggle' | 'rotate' | 'delete',
    active?: boolean
  ) {
    void run(async () => {
      const data = await request(PATH, { action, id, active });
      if (action === 'test') {
        const delivery = data.delivery as WebhookDelivery;
        setFeedback({
          message:
            'Test: ' +
            DELIVERY_LABELS[delivery.result] +
            (delivery.response_status
              ? ' (HTTP ' + delivery.response_status + ')'
              : ''),
          error: delivery.result !== 'delivered',
        });
        const log = await request(PATH + '?id=' + id);
        setHistory({ id, rows: log.deliveries });
        return;
      }
      if (action === 'rotate') setSecret(data.secret);
      if (action === 'delete' && history?.id === id) setHistory(null);
      await refresh();
      setFeedback({
        message:
          action === 'rotate'
            ? 'Secret rotated. Delivery is paused until you enable it again.'
            : action === 'delete'
              ? 'Webhook deleted.'
              : active
                ? 'Webhook enabled.'
                : 'Webhook paused.',
      });
    });
  }

  const visible = endpoints.filter((endpoint) =>
    (endpoint.name + ' ' + new URL(endpoint.url).hostname)
      .toLowerCase()
      .includes(search.toLowerCase().trim())
  );

  return (
    <div className="min-w-0 space-y-4">
      <SettingsPanelHead
        title="Webhook Manager"
        description="Send workspace events to n8n or another tool."
      />
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            setForm(EMPTY_FORM);
            setFeedback(null);
          }}
          disabled={busy || !!form}
        >
          Create webhook
        </Button>
        {endpoints.length > 0 && (
          <Input
            aria-label="Search webhooks"
            placeholder="Search webhooks"
            className="max-w-64"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        )}
      </div>

      {feedback && (
        <p
          role="status"
          className={
            feedback.error
              ? 'text-destructive text-sm'
              : 'text-muted-foreground text-sm'
          }
        >
          {feedback.message}
        </p>
      )}

      {secret && (
        <Card>
          <CardHeader>
            <CardTitle>Signing secret</CardTitle>
            <CardDescription>
              Save this secret in the receiving tool to verify requests. It is
              shown once.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              aria-label="Signing secret"
              readOnly
              value={secret}
              className="font-mono"
              onFocus={(event) => event.target.select()}
            />
            <Button variant="outline" onClick={() => setSecret('')}>
              Done
            </Button>
          </CardContent>
        </Card>
      )}

      {form && (
        <Card>
          <CardHeader>
            <CardTitle>
              {form.id ? 'Edit webhook' : 'Configure webhook'}
            </CardTitle>
            <CardDescription>
              Events are sent as signed JSON using HTTP POST.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="space-y-4">
              <fieldset disabled={busy} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                  <div className="space-y-2">
                    <Label htmlFor="webhook-name">Webhook name</Label>
                    <Input
                      id="webhook-name"
                      required
                      maxLength={80}
                      value={form.name}
                      onChange={(event) =>
                        setForm({ ...form, name: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="webhook-url">Destination URL</Label>
                    <Input
                      id="webhook-url"
                      type="url"
                      required
                      maxLength={2048}
                      placeholder="https://…"
                      value={form.url}
                      onChange={(event) =>
                        setForm({ ...form, url: event.target.value })
                      }
                    />
                  </div>
                </div>
                <fieldset className="space-y-1">
                  <legend className="mb-2 text-sm font-medium">
                    When should WACRM send an event?
                  </legend>
                  {WEBHOOK_EVENTS.map((event) => (
                    <label
                      key={event}
                      className="flex min-h-9 items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="accent-primary size-4"
                        checked={form.events.includes(event)}
                        onChange={() =>
                          setForm({
                            ...form,
                            events: toggleValue(form.events, event),
                          })
                        }
                      />
                      {EVENT_LABELS[event]}
                    </label>
                  ))}
                </fieldset>
                <details>
                  <summary className="cursor-pointer text-sm font-medium">
                    Payload fields
                  </summary>
                  <div className="mt-2">
                    {form.payloadFields === null ? (
                      <Button
                        variant="outline"
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            payloadFields: [...DEFAULT_WEBHOOK_FIELDS],
                          })
                        }
                      >
                        Choose fields for this existing webhook
                      </Button>
                    ) : (
                      <>
                        <p className="text-muted-foreground mb-2 text-xs">
                          The event ID, event type, workspace ID and time are
                          always included. Selected fields are included where
                          available.
                        </p>
                        {Object.entries(WEBHOOK_PAYLOAD_FIELDS).map(
                          ([key, label]) => (
                            <label
                              key={key}
                              className="flex min-h-9 items-center gap-2 text-sm"
                            >
                              <input
                                type="checkbox"
                                className="accent-primary size-4"
                                checked={form.payloadFields?.includes(key)}
                                onChange={() =>
                                  setForm({
                                    ...form,
                                    payloadFields: toggleValue(
                                      form.payloadFields ?? [],
                                      key
                                    ),
                                  })
                                }
                              />
                              {label}
                            </label>
                          )
                        )}
                      </>
                    )}
                  </div>
                </details>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={!form.events.length}>
                    {busy ? 'Saving…' : 'Save webhook'}
                  </Button>
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => setForm(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </fieldset>
            </form>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p role="status">Loading webhooks…</p>
      ) : !visible.length ? (
        <Card>
          <CardContent className="text-muted-foreground py-6 text-sm">
            {search
              ? 'No matching webhooks.'
              : 'No webhooks configured for this workspace.'}
          </CardContent>
        </Card>
      ) : (
        visible.map((endpoint) => {
          const domain = new URL(endpoint.url).hostname;
          const name = endpoint.name ?? domain;
          return (
            <Card key={endpoint.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="break-all">{name}</CardTitle>
                  <span className="bg-muted rounded-full px-2.5 py-1 text-xs font-medium">
                    {endpoint.is_active ? 'Active' : 'Paused'}
                  </span>
                </div>
                <CardDescription className="break-all">
                  {domain}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm">
                  {endpoint.events
                    .map(
                      (event) => EVENT_LABELS[event as WebhookEvent] ?? event
                    )
                    .join(', ')}
                </p>
                <p className="text-muted-foreground text-xs">
                  {endpoint.last_delivery_at
                    ? 'Last successful delivery ' +
                      showDate(endpoint.last_delivery_at)
                    : 'No successful live deliveries'}
                  {endpoint.failure_count > 0 &&
                    ' · ' + endpoint.failure_count + ' consecutive failures'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => manage(endpoint.id, 'test')}
                  >
                    Send test
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      manage(endpoint.id, 'toggle', !endpoint.is_active)
                    }
                  >
                    {endpoint.is_active ? 'Pause' : 'Enable'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      setForm({
                        id: endpoint.id,
                        name,
                        url: endpoint.url,
                        events: endpoint.events as WebhookEvent[],
                        payloadFields: endpoint.payload_fields,
                      })
                    }
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-expanded={history?.id === endpoint.id}
                    onClick={() => {
                      if (history?.id === endpoint.id) setHistory(null);
                      else
                        void run(async () => {
                          const data = await request(
                            PATH + '?id=' + endpoint.id
                          );
                          setHistory({
                            id: endpoint.id,
                            rows: data.deliveries,
                          });
                        });
                    }}
                  >
                    Delivery history
                  </Button>
                </div>
                <details>
                  <summary className="text-muted-foreground cursor-pointer text-sm">
                    More actions
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            'Rotate the signing secret and pause delivery?'
                          )
                        )
                          manage(endpoint.id, 'rotate');
                      }}
                    >
                      Rotate signing secret
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            'Delete this webhook and its delivery history?'
                          )
                        )
                          manage(endpoint.id, 'delete');
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </details>
                {history?.id === endpoint.id && (
                  <div className="rounded-md border p-3">
                    <h3 className="mb-2 text-sm font-medium">
                      Recent deliveries
                    </h3>
                    {history.rows.length ? (
                      <ul className="divide-y text-xs">
                        {history.rows.map((delivery, index) => (
                          <li
                            key={index}
                            className="flex flex-wrap justify-between gap-1 py-2"
                          >
                            <span>
                              {EVENT_LABELS[delivery.event as WebhookEvent] ??
                                delivery.event}
                            </span>
                            <span>
                              {DELIVERY_LABELS[delivery.result]}
                              {delivery.response_status
                                ? ' (HTTP ' + delivery.response_status + ')'
                                : ''}
                            </span>
                            <time dateTime={delivery.created_at}>
                              {showDate(delivery.created_at)}
                            </time>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground text-xs">
                        No delivery attempts yet.
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
