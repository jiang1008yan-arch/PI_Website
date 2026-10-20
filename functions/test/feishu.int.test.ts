import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setAiFetch } from "../lib/aiTriage";
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
    if (path.startsWith("/bitable/") && init?.method === "POST") return json({ code: 0, data: { record: { record_id: `rec_${++nextId}` } } });
    if (path.startsWith("/bitable/")) return json({ code: 0, data: { items: [{ field_name: "工单号", type: 1 }, { field_name: "提交日期", type: 5 }] } });
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
    APP_BASE_URL: "https://portal.example",
    AI_KEY_SECRET: "test-ai-master"
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
  setAiFetch(null);
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

  it("a direct message first gets a small 'create a ticket?' card; Ignore closes it, Create opens the form", async () => {
    await push("/feishu/events", {
      schema: "2.0",
      header: { event_id: "e-dm", token: "vt", event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: "ou_service" }, sender_type: "user" },
        message: { message_id: "om_dm", chat_id: "oc_dm", chat_type: "p2p", message_type: "text", content: JSON.stringify({ text: "你好" }) }
      }
    });
    await h.settle();
    const prompt = messages((c) => c.body?.msg_type === "interactive");
    expect(prompt).toHaveLength(1);
    const promptJson = JSON.parse(prompt[0].body.content);
    const buttons = promptJson.body.elements.filter((e: any) => e.tag === "button").map((b: any) => b.behaviors[0].value.action);
    expect(buttons).toEqual(["open_draft", "dismiss_draft"]);
    expect(JSON.stringify(promptJson)).not.toContain("confirm_draft"); // no form yet
    const draftId = promptJson.body.elements.find((e: any) => e.tag === "button").behaviors[0].value.draftId;

    // Ignore: the card is replaced, nothing created.
    expect((await cardAction("ou_service", { action: "dismiss_draft", draftId }, {}, "e-ignore", "om_prompt")).body.toast.type).toBe("info");
    await h.settle();
    const ignored = messages((c) => c.method === "PATCH" && c.path === "/im/v1/messages/om_prompt");
    expect(JSON.parse(ignored[0].body.content).header.title.content).toContain("Ignored");

    // Create: the card turns into the form.
    calls = [];
    await cardAction("ou_service", { action: "open_draft", draftId }, {}, "e-open", "om_prompt");
    await h.settle();
    const opened = messages((c) => c.method === "PATCH" && c.path === "/im/v1/messages/om_prompt");
    expect(JSON.stringify(JSON.parse(opened[0].body.content))).toContain("confirm_draft");
    expect((await h.db.prepare("SELECT COUNT(*) AS n FROM tickets").first<{ n: number }>())?.n).toBe(0);
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
    // The creator owns the ticket and gets its card privately; the group is not told; the customer got a receipt reply only.
    expect(ticket.assignedServiceId).toBe(h.users.SERVICE.id);
    expect(messages((c) => c.body?.receive_id === "ou_service" && c.body.msg_type === "interactive" && c.body.content.includes(ticket.ticketNo))).toHaveLength(1);
    expect(messages((c) => c.body?.receive_id === SERVICE_CHAT)).toHaveLength(0);
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

describe("working a ticket from the owner's card", () => {
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

  it("take, update with a note, resolve: the owner's card refreshes, sales is told privately, the customer hears only about resolution", async () => {
    expect((await cardAction("ou_sales", { action: "take", ticketId })).body.toast.type).toBe("warning"); // sales cannot take
    expect((await cardAction("ou_service", { action: "take", ticketId })).body.toast.type).toBe("success");
    await h.settle();
    const afterTake = await h.db.prepare("SELECT status, assignedServiceId, feishuCardMessageId FROM tickets WHERE id = ?").bind(ticketId).first<any>();
    expect(afterTake).toMatchObject({ status: "IN_PROGRESS", assignedServiceId: h.users.SERVICE.id });

    await cardAction("ou_service", { action: "update", ticketId }, { note: "Replaced the network module" });
    // A ticket cannot be resolved before it is classified.
    const unclassified = await cardAction("ou_service", { action: "update", ticketId }, { status: "RESOLVED" });
    expect(unclassified.body.toast).toMatchObject({ type: "error", content: "Choose the ticket type before resolving it." });
    expect((await h.request("SERVICE", "PATCH", `/tickets/${ticketId}/type`, { ticketType: "OTHER" })).status).toBe(200);
    await cardAction("ou_service", { action: "update", ticketId }, { status: "RESOLVED" });
    await h.settle();

    // Taking it sent the card to the new owner; later changes refresh that card.
    const card = afterTake.feishuCardMessageId;
    expect(messages((c) => c.body?.receive_id === "ou_service" && c.body.msg_type === "interactive")).toHaveLength(1);
    expect(messages((c) => c.method === "PATCH" && c.path === `/im/v1/messages/${card}`).length).toBeGreaterThanOrEqual(3);
    expect(messages((c) => c.body?.receive_id === SERVICE_CHAT)).toHaveLength(0);
    const toSales = messages((c) => c.body?.receive_id === "ou_sales").map((c) => JSON.parse(c.body.content).text);
    expect(toSales.length).toBeGreaterThanOrEqual(3);
    expect(toSales.some((t) => t.includes("Replaced the network module"))).toBe(true);
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

describe("AI keys, types, the requirement pool and owners", () => {
  const POOL = "https://acme.feishu.cn/base/bascnPool1?table=tblReq1&view=vew1";
  let aiCalls: string[];
  const dm = (openId: string, text: string, messageId: string) =>
    push("/feishu/events", {
      schema: "2.0",
      header: { event_id: `e-${messageId}`, token: "vt", event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: openId }, sender_type: "user" },
        message: { message_id: messageId, chat_id: "oc_dm", chat_type: "p2p", message_type: "text", content: JSON.stringify({ text }) }
      }
    });
  const lastDraftId = async () => (await h.db.prepare("SELECT id FROM feishuDrafts ORDER BY rowid DESC LIMIT 1").first<{ id: string }>())!.id;

  beforeEach(async () => {
    await h.db.prepare("UPDATE users SET feishuOpenId = 'ou_service' WHERE id = ?").bind(h.users.SERVICE.id).run();
    await h.db.prepare("UPDATE users SET feishuOpenId = 'ou_admin' WHERE id = ?").bind(h.users.ADMIN.id).run();
    aiCalls = [];
    setAiFetch((async (_url: string, init: RequestInit) => {
      aiCalls.push((init.headers as Record<string, string>).Authorization);
      const body = JSON.parse(String(init.body));
      const content = body.max_tokens <= 20 ? '{"ok": true}' : '{"summary":"客户希望支持 OCPP 2.0.1","ticketType":"PRODUCT_REQUEST","faultType":"none"}';
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
    }) as unknown as typeof fetch);
  });

  it("uses the AI key of whoever presses Create, and none for someone without a key", async () => {
    await h.request("SERVICE", "PUT", "/me/ai", { provider: "QWEN", apiKey: "sk-service-key-1" });
    aiCalls = [];

    await dm("ou_admin", "能不能支持 OCPP 2.0.1", "om_a1");
    await h.settle();
    await cardAction("ou_admin", { action: "open_draft", draftId: await lastDraftId() }, {}, "e-a-open", "om_p1");
    await h.settle();
    expect(aiCalls).toEqual([]); // the admin has no key

    await dm("ou_service", "能不能支持 OCPP 2.0.1", "om_s1");
    await h.settle();
    calls = [];
    await cardAction("ou_service", { action: "open_draft", draftId: await lastDraftId() }, {}, "e-s-open", "om_p2");
    await h.settle();
    expect(aiCalls).toEqual(["Bearer sk-service-key-1"]);
    const form = JSON.stringify(JSON.parse(messages((c) => c.method === "PATCH" && c.path === "/im/v1/messages/om_p2")[0].body.content));
    expect(form).toContain('"initial_option":"PRODUCT_REQUEST"');
    expect(form).toContain("客户希望支持 OCPP 2.0.1");
  });

  it("a product request created from Feishu is owned by its creator and written once to the requirement pool", async () => {
    await h.request("ADMIN", "PUT", "/options/requirementPoolUrl", { values: [POOL] });
    await dm("ou_service", "希望 App 能远程升级固件", "om_s2");
    await h.settle();
    const draftId = await lastDraftId();
    calls = [];
    const res = await cardAction(
      "ou_service",
      { action: "confirm_draft", draftId },
      { contactName: "Ana", customerCompany: "ACME", ticketType: "PRODUCT_REQUEST", summary: "远程升级固件", faultType: "Offline / no network" }
    );
    expect(res.body.toast.type).toBe("success");
    await h.settle();

    const ticket = await h.db.prepare("SELECT * FROM tickets").first<any>();
    expect(ticket).toMatchObject({ ticketType: "PRODUCT_REQUEST", faultType: null, summary: "远程升级固件", assignedServiceId: h.users.SERVICE.id });
    const writes = calls.filter((c) => c.path.startsWith("/bitable/v1/apps/bascnPool1/tables/tblReq1/records") && c.method === "POST");
    expect(writes).toHaveLength(1);
    expect(writes[0].body.fields).toMatchObject({ 工单号: ticket.ticketNo, 客户: "ACME", 摘要: "远程升级固件", 客户原话: "希望 App 能远程升级固件", 售后负责人: "Test SERVICE" });
    expect(ticket.bitableRecordId).toMatch(/^rec_/);

    // Classifying it again does not write a second row.
    await h.request("SERVICE", "PATCH", `/tickets/${ticket.id}/type`, { ticketType: "OTHER" });
    await h.request("SERVICE", "PATCH", `/tickets/${ticket.id}/type`, { ticketType: "PRODUCT_REQUEST" });
    await h.settle();
    expect(calls.filter((c) => c.path.startsWith("/bitable/") && c.method === "POST")).toHaveLength(1);
  });

  it("admins can check the pool table's columns", async () => {
    expect((await h.request("SERVICE", "GET", "/feishu/requirement-pool/check")).status).toBe(403);
    expect((await h.request("ADMIN", "GET", "/feishu/requirement-pool/check")).body).toMatchObject({ ok: false, error: "No requirement pool link saved yet." });
    await h.request("ADMIN", "PUT", "/options/requirementPoolUrl", { values: ["https://acme.feishu.cn/wiki/abc"] });
    expect((await h.request("ADMIN", "GET", "/feishu/requirement-pool/check")).body.error).toContain("not a Bitable table link");
    await h.request("ADMIN", "PUT", "/options/requirementPoolUrl", { values: [POOL] });
    const check = (await h.request("ADMIN", "GET", "/feishu/requirement-pool/check")).body;
    expect(check.ok).toBe(false);
    expect(check.notText).toEqual(["提交日期"]);
    expect(check.missing).toContain("客户原话");
  });

  it("a direct message saying 绑定 gets the link card instead of the ticket prompt", async () => {
    await dm("ou_someone", "绑定", "om_bind");
    await h.settle();
    const sent = messages((c) => c.body?.msg_type === "interactive");
    expect(sent).toHaveLength(1);
    expect(sent[0].body.receive_id).toBe("ou_someone");
    expect(sent[0].body.content).toContain("feishu/bind?token=");
    expect((await h.db.prepare("SELECT COUNT(*) AS n FROM feishuDrafts").first<{ n: number }>())?.n).toBe(0);
  });

  it("a hand-over moves the card to the new owner and marks the old one", async () => {
    const id = (await h.request("SERVICE", "POST", "/tickets", { contactName: "Li", contactInfo: "x", productId: await seedProduct(h.db), answers: {} })).body.id;
    await h.settle();
    const oldCard = (await h.db.prepare("SELECT feishuCardMessageId FROM tickets WHERE id = ?").bind(id).first<any>()).feishuCardMessageId;
    expect(oldCard).toMatch(/^om_/);
    calls = [];
    await h.request("SERVICE", "PATCH", `/tickets/${id}/assign`, { assignedServiceId: h.users.ADMIN.id });
    await h.settle();
    const toAdmin = messages((c) => c.body?.receive_id === "ou_admin" && c.body.msg_type === "interactive");
    expect(toAdmin).toHaveLength(1);
    const handedOver = messages((c) => c.method === "PATCH" && c.path === `/im/v1/messages/${oldCard}`);
    expect(handedOver[0].body.content).toContain("handed over");
    const row = await h.db.prepare("SELECT feishuCardMessageId, feishuCardOwnerId FROM tickets WHERE id = ?").bind(id).first<any>();
    expect(row).toMatchObject({ feishuCardOwnerId: h.users.ADMIN.id });
    expect(row.feishuCardMessageId).not.toBe(oldCard);
  });
});
