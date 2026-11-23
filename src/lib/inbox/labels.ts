import type { Tag } from "@/types";

export const INBOX_LABEL_BATCH = 100;
export const META_INBOX_SOURCES = ["whatsapp", "instagram_dm", "messenger"] as const;

export type InboxTag = Pick<Tag, "id" | "name" | "color">;
export type CapiStatus = "accepted" | "pending" | "sending" | "failed" | "retrying" | "skipped" | "tested" | "needs_review" | "not_sent";
export type CapiStage = "new" | "qualified";
export type CapiLabel = { status: CapiStatus; test: boolean };
export type CapiEventLabel = CapiLabel & {
  stage: CapiStage;
  eventName: string;
  occurredAt: string;
  sentAt: string | null;
  attempts: number;
  issue?: "credentials" | "identifiers" | "uncertain" | "delivery";
};
export type InboxLabels = Record<string, { tags: InboxTag[]; capi?: { latest: CapiLabel; events: CapiEventLabel[] } }>;

export type InboxThreadIdentity = {
  id: string;
  contact_id: string;
  channel: "whatsapp" | "instagram" | "messenger";
  channel_account_id: string | null;
  channel_sender_id: string | null;
};

export type StoredCapiEvent = {
  id: string;
  source: string;
  stage: CapiStage;
  destination: string;
  test_mode: boolean;
  state: Exclude<CapiStatus, "not_sent">;
  event_time: string;
  sent_at: string | null;
  attempts: number;
  reason: string | null;
};

export type InboxMetaLead = {
  contact_id: string;
  source: string;
  status: string;
  meta_event_key: string;
  attribution: { ctwa_clid?: unknown; whatsapp_business_account_id?: unknown } | null;
  lead_status_history: { status: string }[];
  conversion_feedback_events: StoredCapiEvent[];
};

export type InboxMetaRule = { test_mode: boolean; messagingAccount: string };

export function inboxLeadKey(lead: InboxMetaLead) {
  const [source, account, sender] = lead.meta_event_key.split(":", 3);
  if (lead.source !== source) return null;
  return source === "whatsapp"
    ? [source, lead.contact_id].join(":")
    : [source, lead.contact_id, account, sender].join(":");
}

export function inboxThreadKey(thread: InboxThreadIdentity) {
  return thread.channel === "whatsapp"
    ? ["whatsapp", thread.contact_id].join(":")
    : [thread.channel === "instagram" ? "instagram_dm" : "messenger", thread.contact_id,
      thread.channel_account_id, thread.channel_sender_id].join(":");
}

function issueFor(event: StoredCapiEvent): CapiEventLabel["issue"] {
  if (event.state === "needs_review") return "uncertain";
  if (!["failed", "retrying", "skipped"].includes(event.state)) return undefined;
  if (/credential|token|destination|^meta_error_190$|^meta_http_40[13]$/.test(event.reason ?? "")) return "credentials";
  if (/identifiers|account_mismatch/.test(event.reason ?? "")) return "identifiers";
  return "delivery";
}

export function inboxCapiLabel(lead: InboxMetaLead, rule: InboxMetaRule | undefined, showDiagnostics: boolean): InboxLabels[string]["capi"] {
  const events = lead.conversion_feedback_events
    .filter(event => event.source === lead.source &&
      (event.stage === "new" || event.stage === "qualified") &&
      ["accepted", "pending", "sending", "failed", "retrying", "skipped", "tested", "needs_review"].includes(event.state))
    .sort((a, b) => Number(b.stage === "qualified") - Number(a.stage === "qualified") ||
      Number(a.test_mode) - Number(b.test_mode) || b.event_time.localeCompare(a.event_time) || b.id.localeCompare(a.id));
  const newest = events[0];
  const ids = lead.attribution;
  const attributable = lead.source === "whatsapp"
    ? typeof ids?.ctwa_clid === "string" && lead.meta_event_key === "whatsapp:click:" + ids.ctwa_clid &&
      ids.whatsapp_business_account_id === rule?.messagingAccount
    : lead.meta_event_key.split(":", 3)[1] === rule?.messagingAccount;

  // Opening a thread is not a submitted lead. Only label a reached qualification as unsent.
  const qualificationUnsent = rule && attributable &&
    (lead.status === "qualified" || lead.lead_status_history.some(entry => entry.status === "qualified")) &&
    !(newest?.stage === "qualified" && !newest.test_mode) &&
    !events.some(event => event.stage === "qualified" && event.test_mode === rule.test_mode);

  const latest: CapiLabel | undefined = qualificationUnsent
    ? { status: "not_sent", test: rule.test_mode }
    : newest && { status: newest.state, test: newest.test_mode || newest.state === "tested" };
  if (!latest) return undefined;
  return {
    latest,
    events: events.map(event => ({
      status: event.state,
      test: event.test_mode || event.state === "tested",
      stage: event.stage,
      eventName: event.destination,
      occurredAt: event.event_time,
      sentAt: event.sent_at,
      attempts: event.attempts,
      ...(showDiagnostics && { issue: issueFor(event) }),
    })),
  };
}
