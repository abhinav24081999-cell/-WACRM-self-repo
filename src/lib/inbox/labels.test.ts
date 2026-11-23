import { expect, it } from "vitest";
import { inboxCapiLabel, inboxLeadKey, inboxThreadKey, type InboxMetaLead, type StoredCapiEvent } from "./labels";

const time = "2026-11-23T10:00:00.000Z";
const event: StoredCapiEvent = {
  id: "1", source: "whatsapp", stage: "qualified", destination: "QualifiedLead",
  test_mode: false, state: "accepted", event_time: time, sent_at: time, attempts: 1, reason: null,
};
const lead: InboxMetaLead = {
  contact_id: "contact", source: "whatsapp", status: "qualified", meta_event_key: "whatsapp:click:click",
  attribution: {ctwa_clid: "click", whatsapp_business_account_id: "123"},
  lead_status_history: [{status: "qualified"}], conversion_feedback_events: [],
};

it("keeps Meta form events and other social identities off the WhatsApp row", () => {
  const thread = {id: "thread", contact_id: "contact", channel_account_id: "123", channel_sender_id: "456"};
  const instagram = {...lead, source: "instagram_dm", meta_event_key: "instagram_dm:123:456:referral"};
  const instagramKey = inboxLeadKey(instagram);
  expect(instagramKey).toBe(inboxThreadKey({...thread, channel: "instagram"}));
  expect(instagramKey).not.toBe(inboxThreadKey({...thread, channel: "messenger"}));
  expect(instagramKey).not.toBe(inboxThreadKey({...thread, channel: "whatsapp"}));
  expect(instagramKey).not.toBe(inboxThreadKey({...thread, channel: "instagram", channel_sender_id: "789"}));
  expect(instagramKey).not.toBe(inboxThreadKey({...thread, channel: "instagram", contact_id: "another"}));
  expect(inboxLeadKey({...instagram, source: "messenger"})).toBeNull();
});

it("labels a reached, configured qualification as unsent, and leaves referrals without a conversion blank", () => {
  const rule = {test_mode: false, messagingAccount: "123"};
  expect(inboxCapiLabel(lead, rule, false)?.latest).toEqual({status: "not_sent", test: false});
  expect(inboxCapiLabel({...lead, status: "new", lead_status_history: []}, rule, false)).toBeUndefined();
  expect(inboxCapiLabel({...lead, attribution: null}, rule, false)).toBeUndefined();
  expect(inboxCapiLabel(lead, undefined, false)).toBeUndefined();
  expect(inboxCapiLabel(lead, {...rule, messagingAccount: "456"}, false)).toBeUndefined();
  expect(inboxCapiLabel({...lead, conversion_feedback_events: [{...event, stage:"new"}, {...event, test_mode: true, state: "tested"}]}, rule, false)?.latest)
    .toEqual({status: "not_sent", test: false});
});

it.each(["pending", "sending", "retrying", "failed", "skipped", "needs_review", "accepted"] as const)
  ("uses the latest qualified event’s current %s state over an older positive receipt", (state) => {
    const conversion_feedback_events = [{...event, stage: "new" as const}, {...event, id: "2", state, attempts: 3}];
    expect(inboxCapiLabel({...lead, conversion_feedback_events}, undefined, false)?.latest).toEqual({status: state, test: false});
  });

it("clearly identifies tests and limits diagnostic text to admins", () => {
  const failed = {...lead, conversion_feedback_events: [{...event, state: "failed" as const, reason: "meta_error_190"}]};
  expect(inboxCapiLabel(failed, undefined, true)?.events[0].issue).toBe("credentials");
  expect(inboxCapiLabel(failed, undefined, false)?.events[0]).not.toHaveProperty("issue");
  expect(inboxCapiLabel({...lead, conversion_feedback_events: [{...event, test_mode: true, state: "tested"}]}, undefined, false)?.latest)
    .toEqual({status: "tested", test: true});
});
