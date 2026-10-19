import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setFeishuFetch } from "../lib/feishu/client";
import { drainFeishuOutbox } from "../lib/feishu/sync";
import { createHarness, seedProduct, type Harness } from "./harness";

// The Feishu bot end to end against a fake Feishu Open API: binding, @bot
// requests, confirming a ticket from the private card, updating it from the
// group card, and keeping the card / customer group / sales in step with
// changes made in the portal.

type Call = { method: string; path: string; body: any };

let h: Harness;
let calls: Call[];
let failing: boolean;
let nextId: number;

const SERVICE_CHAT = "oc_service";
const CUSTOMER_CHAT = "oc_customer";

function fakeFeishu(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace("/open-apis", "") + url.search;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method: init?.method ?? "GET", path, body });
    const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
    if (path.startsWith("/auth/v3/tenant_access_token")) return json({ code: 0, tenant_access_token: "t-1", expire: 7200 });
    if (failing) return json({ code: 99991400, msg: "rate limited" });
    if (path.startsWith("/im/v1/messages/om_parent") && (init?.method ?? "GET") === "GET") {
      return json({ code: 0, data: { items: [{ msg_type: "text", body: { content: JSON.stringify({ text: "Charger on PO-2026-0901 keeps going offline" }) } }] } });
    }
    return json({ code: 0, data: { message_id: `om_${++nextId}` } });
  }) as typeof fetch;
}

const push = (path: string, payload: unknown) => h.raw("POST", path, JSON.stringify(payload));
const cardAction = (openId: string, value: Record<string, string>, form: Record<string, string> = {}, eventId = `ev_${Math.random()}`, messageId = "om_card") =>
  push("/feishu/card", {
    schema: "2.0",
    header: { event_id: eventId, token: "vt", event_type: "card.action.trigger" },
    event: { operator: { open_id: openId }, action: { value, form_value: form, tag: "button" }, context: { open_message_id: messageId, open_chat_id: SERVICE_CHAT } }
  });
const messages = (filter: (c: Call) => boolean) => calls.filter((c) => c.path.startsWith("/im/v1/messages") && filter(c));

beforeEach(async () => {
  h = await createHarness({
    FEISHU_APP_ID: "cli_test",
    FEISHU_APP_SECRET: "secret",
    FEISHU_VERIFICATION_TOKEN: "vt",
    FEISHU_SERVICE_CHAT_ID: SERVICE_CHAT,
    APP_BASE_URL: "https://portal.example"
  });
  calls = [];
  failing = false;
  nextId = 0;
  setFeishuFetch(fakeFeishu());
  await h.request("ADMIN", "PUT", "/options/faultType", { values: ["Offline / no network", "Screen fault"] });
  await h.db.prepare("UPDATE users SET feishuOpenId = 'ou_sales' WHERE id = ?").bind(h.users.SALES.id).run();
});
afterEach(async () => {
  setFeishuFetch(null);
  await h.close();
});

describe("Feishu push endpoints", () => {
  it("answers the URL verification handshake and rejects a wrong token", async () => {
    expect((await push("/feishu/events", { type: "url_verification", token: "vt", challenge: "abc" })).body).toEqual({ challenge: "abc" });
    expect((await push("/feishu/events", { type: "url_verification", token: "nope", challenge: "abc" })).status).toBe(401);
    expect((await push("/feishu/card", { schema: "2.0", header: { token: "nope" }, event: {} })).status).toBe(401);
  });
});

describe("binding", () => {
  it("an unbound user gets a private link; opening it in the portal binds the account", async () => {
    const res = await cardAction("ou_new", { action: "take", ticketId: "x" });
    expect(res.body.toast.type).toBe("warning");
    await h.settle();
    const dm = messages((c) => c.path.includes("receive_id_type=open_id"));
    expect(dm).toHaveLength(1);
    expect(dm[0].body.receive_id).toBe("ou_new");
    const link = JSON.stringify(JSON.parse(dm[0].body.content));
    const token = /token=([^"&\\]+)/.exec(link)![1];

    expect((await h.request("SERVICE", "POST", "/feishu/bind", { token: "wrong" })).status).toBe(400);
    expect((await h.request("SERVICE", "POST", "/feishu/bind", { token })).status).toBe(200);
    expect((await h.request("SERVICE", "POST", "/feishu/bind", { token })).status).toBe(400); // one-time
    const bound = await h.db.prepare("SELECT feishuOpenId FROM users WHERE id = ?").bind(h.users.SERVICE.id).first<{ feishuOpenId: string }>();
    expect(bound?.feishuOpenId).toBe("ou_new");
  });
});

describe("turning a chat message into a ticket", () => {
  beforeEach(async () => {
    await h.db.prepare("UPDATE users SET feishuOpenId = 'ou_service' WHERE id = ?").bind(h.users.SERVICE.id).run();
  });

  it("a direct message to the bot gets usage help, not a ticket card", async () => {
    await push("/feishu/events", {
      schema: "2.0",
      header: { event_id: "e-dm", token: "vt", event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: "ou_service" }, sender_type: "user" },
        message: { message_id: "om_dm", chat_id: "oc_dm", chat_type: "p2p", message_type: "text", content: JSON.stringify({ text: "你好" }) }
      }
    });
    await h.settle();
    expect((await h.db.prepare("SELECT COUNT(*) AS n FROM feishuDrafts").first<{ n: number }>())?.n).toBe(0);
    const replies = messages((c) => c.path === "/im/v1/messages/om_dm/reply");
    expect(replies).toHaveLength(1);
    expect(JSON.parse(replies[0].body.content).text).toContain("@");
    expect(messages((c) => c.body?.msg_type === "interactive")).toEqual([]);
  });

  it("a staff @bot reply sends a private confirmation card; confirming creates the ticket and its group card", async () => {
    const event = {
      schema: "2.0",
      header: { event_id: "e1", token: "vt", event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: "ou_service" }, sender_type: "user" },
        message: { message_id: "om_reply", parent_id: "om_parent", chat_id: CUSTOMER_CHAT, chat_type: "group", message_type: "text", content: JSON.stringify({ text: "@_user_1 please log this" }) }
      }
    };
    expect((await push("/feishu/events", event)).status).toBe(200);
    expect((await push("/feishu/events", event)).status).toBe(200); // redelivery is ignored
    await h.settle();

    const drafts = await h.db.prepare("SELECT * FROM feishuDrafts").all<any>();
    expect(drafts.results).toHaveLength(1);
    expect(drafts.results[0]).toMatchObject({ sourceChatId: CUSTOMER_CHAT, sourceMessageId: "om_parent", aiSummary: null });
    expect(drafts.results[0].text).toContain("keeps going offline");
    const confirmCard = messages((c) => c.path.includes("receive_id_type=open_id"));
    expect(confirmCard.map((c) => c.body.receive_id)).toEqual(["ou_service"]);

    // Contact name is required.
    expect((await cardAction("ou_service", { action: "confirm_draft", draftId: drafts.results[0].id }, {})).body.toast.type).toBe("warning");
    const created = await cardAction(
      "ou_service",
      { action: "confirm_draft", draftId: drafts.results[0].id },
      { customerCompany: "Iberia Charge SL", orderNo: "PO-2026-0901", contactName: "Ana", faultType: "Offline / no network" },
      "e-confirm",
      "om_confirm_card"
    );
    expect(created.body.toast).toMatchObject({ type: "success" });
    await h.settle();

    const ticket = await h.db.prepare("SELECT * FROM tickets").first<any>();
    expect(ticket).toMatchObject({ status: "NEW", orderNo: "PO-2026-0901", faultType: "Offline / no network", feishuSourceChatId: CUSTOMER_CHAT });
    expect(ticket.feishuCardMessageId).toMatch(/^om_/);
    // The internal card went to the after-sales group; the customer got a receipt reply only.
    expect(messages((c) => c.path.includes("receive_id_type=chat_id") && c.body.receive_id === SERVICE_CHAT && c.body.msg_type === "interactive")).toHaveLength(1);
    const receipt = messages((c) => c.path === "/im/v1/messages/om_parent/reply");
    expect(JSON.parse(receipt[0].body.content).text).toContain(ticket.ticketNo);
    // The private card was updated to say the ticket exists; a second confirm is refused.
    expect(messages((c) => c.method === "PATCH" && c.path === "/im/v1/messages/om_confirm_card")).toHaveLength(1);
    expect((await cardAction("ou_service", { action: "confirm_draft", draftId: drafts.results[0].id }, { contactName: "Ana" })).body.toast.type).toBe("info");
    // Timeline: the quoted customer message, then the fault confirmation.
    const timeline = (await h.request("SERVICE", "GET", `/tickets/${ticket.id}`)).body.updates.map((u: any) => u.note);
    expect(timeline[0]).toContain("From Feishu:");
  });
});

describe("working a ticket from the group card", () => {
  let ticketId: string;
  beforeEach(async () => {
    await h.db.prepare("UPDATE users SET feishuOpenId = 'ou_service' WHERE id = ?").bind(h.users.SERVICE.id).run();
    const productId = await seedProduct(h.db);
    const res = await h.request("SALES", "POST", "/tickets", { customerCompany: "ACME", orderNo: "PO-1", contactName: "Li", contactInfo: "x", productId, answers: {}, assignedSalesId: h.users.SALES.id });
    ticketId = res.body.id;
    await h.db.prepare("UPDATE tickets SET feishuSourceChatId = ? WHERE id = ?").bind(CUSTOMER_CHAT, ticketId).run();
    await h.settle();
    calls = [];
  });

  it("take, update with a note, resolve: the card refreshes, sales is mentioned, the customer hears only about resolution", async () => {
    expect((await cardAction("ou_sales", { action: "take", ticketId })).body.toast.type).toBe("warning"); // sales cannot take
    expect((await cardAction("ou_service", { action: "take", ticketId })).body.toast.type).toBe("success");
    await h.settle();
    const afterTake = await h.db.prepare("SELECT status, assignedServiceId, feishuCardMessageId FROM tickets WHERE id = ?").bind(ticketId).first<any>();
    expect(afterTake).toMatchObject({ status: "IN_PROGRESS", assignedServiceId: h.users.SERVICE.id });

    await cardAction("ou_service", { action: "update", ticketId }, { note: "Replaced the network module" });
    await cardAction("ou_service", { action: "update", ticketId }, { status: "RESOLVED" });
    await h.settle();

    const card = afterTake.feishuCardMessageId;
    expect(messages((c) => c.method === "PATCH" && c.path === `/im/v1/messages/${card}`).length).toBeGreaterThanOrEqual(3);
    const mentions = messages((c) => c.path === `/im/v1/messages/${card}/reply`).map((c) => JSON.parse(c.body.content).text);
    expect(mentions.every((t) => t.startsWith('<at user_id="ou_sales"></at>'))).toBe(true);
    expect(mentions.some((t) => t.includes("Replaced the network module"))).toBe(true);
    const toCustomer = messages((c) => c.body?.receive_id === CUSTOMER_CHAT).map((c) => JSON.parse(c.body.content).text);
    expect(toCustomer).toHaveLength(1);
    expect(toCustomer[0]).toContain("resolved");

    // An invalid transition is refused with a toast, not an error page.
    expect((await cardAction("ou_service", { action: "update", ticketId }, { status: "NEW" })).body.toast.type).toBe("error");
  });

  it("portal changes refresh the card too, and failed pushes are retried", async () => {
    failing = true;
    await h.request("SERVICE", "PATCH", `/tickets/${ticketId}/status`, { status: "IN_PROGRESS" });
    await h.settle();
    let rows = await h.db.prepare("SELECT status, attempts, lastError FROM integrationOutbox WHERE status = 'FAILED'").all<any>();
    expect(rows.results.length).toBeGreaterThan(0);
    expect(rows.results[0].lastError).toContain("rate limited");

    failing = false;
    await drainFeishuOutbox(h.env);
    rows = await h.db.prepare("SELECT status FROM integrationOutbox WHERE status <> 'SENT'").all<any>();
    expect(rows.results).toEqual([]);
  });

  it("does nothing when the bot is not configured", async () => {
    h.env.FEISHU_APP_ID = undefined;
    await h.request("SERVICE", "PATCH", `/tickets/${ticketId}/status`, { status: "IN_PROGRESS" });
    await h.settle();
    expect(calls).toEqual([]);
  });
});
