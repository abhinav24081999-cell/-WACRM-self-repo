import { beforeEach, expect, it, vi } from "vitest";

const { account, admin, conversations, leads } = vi.hoisted(() => ({
  account: vi.fn(), admin: vi.fn(), conversations: vi.fn(), leads: vi.fn(),
}));
vi.mock("@/lib/auth/account", () => ({
  getCurrentAccount: account,
  toErrorResponse: () => new Response(null, { status: 401 }),
}));
vi.mock("@/lib/flows/admin-client", () => ({ supabaseAdmin: admin }));

import { POST } from "./route";

const id = "00000000-0000-0000-0000-000000000001";
const foreign = "00000000-0000-0000-0000-000000000002";
const request = (ids: unknown) => new Request("http://localhost/api/inbox/labels", {
  method: "POST", body: JSON.stringify(ids),
});
const fixtureTag = {id: "tag", name: "FOLLOW UP", color: "#22d3ee"};

function query(data: object[]) {
  const builder = {
    eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(), not: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(),
    returns: vi.fn().mockResolvedValue({data, error: null}),
  };
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  account.mockResolvedValue({ accountId: "workspace", role: "agent", supabase: { from: () => ({select: conversations}) } });
  admin.mockReturnValue({from: () => ({select: leads})});
  vi.stubEnv("CONVERSION_FEEDBACK_WORKSPACE_ID", "unused");
});

it("serves the authorized thread only and returns a scoped summary without provider IDs or errors", async () => {
  const lookup = query([{id, contact_id: "contact", channel: "whatsapp", contact: {contact_tags: [{tag: fixtureTag}]}}]);
  const outbox = query([{
    contact_id: "contact", source: "whatsapp", meta_event_key: "whatsapp:click:private-click", status: "qualified",
    attribution: null, lead_status_history: [],
    conversion_feedback_events: [{
      id: "private-id", state: "failed", stage: "qualified", source: "whatsapp", test_mode: false,
      reason: "meta_error_190", event_time: "2026-11-23T11:00:00Z", sent_at: null, attempts: 1, destination: "QualifiedLead",
    }],
  }]);
  conversations.mockReturnValue(lookup);
  leads.mockReturnValue(outbox);
  const response = await POST(request([id, foreign]));
  const body = await response.json();
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(lookup.eq).toHaveBeenCalledWith("account_id", "workspace");
  expect(outbox.eq).toHaveBeenCalledWith("account_id", "workspace");
  expect(outbox.eq).toHaveBeenCalledWith("conversion_feedback_events.account_id", "workspace");
  expect(outbox.in).toHaveBeenCalledWith("contact_id", ["contact"]);
  expect(Object.keys(body)).toEqual([id]);
  expect(body[id]).toMatchObject({tags: [fixtureTag], capi: {latest: {status: "failed", test: false}}});
  expect(JSON.stringify(body)).not.toMatch(/private-id|private-click|meta_error_190/);
});

it("never reads the outbox for unauthorized IDs or sessions", async () => {
  conversations.mockReturnValue(query([]));
  expect(await (await POST(request([foreign]))).json()).toEqual({});
  expect(admin).not.toHaveBeenCalled();
  expect((await POST(request(["not-an-id"]))).status).toBe(400);
  account.mockRejectedValueOnce(new Error("Unauthenticated"));
  expect((await POST(request([id]))).status).toBe(401);
  expect(admin).not.toHaveBeenCalled();
});

it("shows a saved Meta Instant Form conversion for a contact within the authorized workspace", async () => {
  const lookup = query([{id}]);
  const formLead = {
    contact_id: id, source: "meta_instant_form", meta_event_key: "meta_instant_form:1234",
    status: "converted", attribution: null, lead_status_history: [],
  };
  const outbox = query([
    {...formLead, conversion_feedback_events: []},
    {...formLead, conversion_feedback_events: [{
      id: "event", state: "accepted", stage: "converted", source: "meta_instant_form", test_mode: false,
      reason: null, event_time: "2026-11-23T11:00:00Z", sent_at: null, attempts: 1, destination: "Converted",
    }]},
  ]);
  conversations.mockReturnValue(lookup);
  leads.mockReturnValue(outbox);
  const response = await POST(request({contactIds: [id, foreign]}));
  const body = await response.json();
  expect(lookup.eq).toHaveBeenCalledWith("account_id", "workspace");
  expect(outbox.in).toHaveBeenCalledWith("contact_id", [id]);
  expect(outbox.in).toHaveBeenCalledWith("source", ["whatsapp", "instagram_dm", "messenger", "meta_instant_form"]);
  expect(Object.keys(body)).toEqual([id]);
  expect(body[id].capi).toMatchObject({source: "meta_instant_form", latest: {status: "accepted", test: false}});
});
