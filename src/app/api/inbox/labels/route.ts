import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { hasMinRole } from "@/lib/auth/roles";
import { configuredSources, feedbackWorkspace, liveFeedbackEnabled, messagingConversionAccount } from "@/lib/conversions/providers";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import {
  INBOX_LABEL_BATCH, META_INBOX_SOURCES, inboxCapiLabel, inboxLeadKey, inboxThreadKey,
  type InboxLabels, type InboxMetaLead, type InboxMetaRule, type InboxTag, type InboxThreadIdentity,
} from "@/lib/inbox/labels";
import { readCappedBody } from "@/lib/whatsapp/webhook-body";

const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
type ThreadRow = InboxThreadIdentity & {
  contact: { contact_tags: { tag: InboxTag | null }[] } | null;
};

export async function POST(request: Request) {
  try {
    const { accountId, role, supabase } = await getCurrentAccount();
    const raw = await readCappedBody(request, 4096);
    if (raw === null) return new Response(null, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return new Response(null, { status: 400 }); }
    const contactRequest = typeof body === "object" && body !== null && "contactIds" in body
      ? body
      : undefined;
    const byContact = Boolean(contactRequest);
    const ids = contactRequest ? contactRequest.contactIds : body;
    if (!Array.isArray(ids) || !ids.length || ids.length > INBOX_LABEL_BATCH ||
      !ids.every(id => typeof id === "string" && uuid.test(id))) {
      return new Response(null, { status: 400 });
    }

    const result: InboxLabels = {};
    const pending = new Map<string, string>();
    let contactIds: string[];
    if (byContact) {
      const { data, error } = await supabase.from("contacts").select("id")
        .eq("account_id", accountId).in("id", ids).returns<{ id: string }[]>();
      if (error) return new Response(null, { status: 503 });
      contactIds = (data ?? []).map(contact => contact.id);
      for (const id of contactIds) {
        result[id] = { tags: [] };
        pending.set(id, id);
      }
    } else {
      const { data, error } = await supabase.from("conversations")
        .select("id,contact_id,channel,channel_account_id,channel_sender_id,contact:contacts(contact_tags(tag:tags(id,name,color)))")
        .eq("account_id", accountId).in("id", ids).returns<ThreadRow[]>();
      if (error) return new Response(null, { status: 503 });
      const threads = data ?? [];
      contactIds = [...new Set(threads.map(thread => thread.contact_id))];
      for (const thread of threads) {
        result[thread.id] = { tags: (thread.contact?.contact_tags ?? []).flatMap(row => row.tag ? [row.tag] : []) };
        pending.set(inboxThreadKey(thread), thread.id);
      }
    }

    if (pending.size && hasMinRole(role, "agent")) {
      const admin = supabaseAdmin();
      const metaSources = byContact ? [...META_INBOX_SOURCES, "meta_instant_form"] : META_INBOX_SOURCES;
      const sources = feedbackWorkspace() === accountId ? configuredSources().filter(source => metaSources.some(metaSource => metaSource === source)) : [];
      const rules = new Map<string, InboxMetaRule>();
      if (sources.length) {
        const response = await admin.from("conversion_feedback_rules").select("source,test_mode")
          .eq("account_id", accountId).eq("stage", "qualified").neq("delivery", "off").in("source", sources);
        if (response.error) return new Response(null, { status: 503 });
        for (const rule of response.data ?? []) {
          const messagingAccount = messagingConversionAccount(rule.source);
          if ((messagingAccount || rule.source === "meta_instant_form") && (rule.test_mode || liveFeedbackEnabled())) {
            rules.set(rule.source, { test_mode: rule.test_mode, messagingAccount });
          }
        }
      }

      const pageSize = 200;
      for (let offset = 0; pending.size; offset += pageSize) {
        const response = await admin.from("leads")
          .select("contact_id,source,status,meta_event_key,attribution,lead_status_history(status),conversion_feedback_events(id,source,stage,destination,test_mode,state,event_time,sent_at,attempts,reason)")
          .eq("account_id", accountId).in("contact_id", contactIds).in("source", metaSources)
          .not("meta_event_key", "is", null)
          .eq("lead_status_history.status", "qualified").limit(1, { referencedTable: "lead_status_history" })
          .eq("conversion_feedback_events.account_id", accountId)
          .order("created_at", { ascending: false }).order("id", { ascending: false })
          .range(offset, offset + pageSize - 1).returns<InboxMetaLead[]>();
        if (response.error) return new Response(null, { status: 503 });

        for (const lead of response.data ?? []) {
          const leadKey = inboxLeadKey(lead);
          if (!leadKey) continue;
          const key = byContact ? lead.contact_id : leadKey;
          const threadId = key && pending.get(key);
          if (!key || !threadId) continue;
          const capi = inboxCapiLabel(lead, rules.get(lead.source), hasMinRole(role, "admin"));
          // A contact may have a newer Meta lead with no event yet.
          if (!byContact || capi) pending.delete(key);
          if (capi) result[threadId].capi = { ...capi, source: lead.source };
        }
        if ((response.data?.length ?? 0) < pageSize) break;
      }
    }

    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
