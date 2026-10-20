import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setAiFetch } from "../lib/aiTriage";
import { loadUserAiConfig } from "../lib/userAi";
import { applyMigrations, createD1, createHarness, seedProduct, type Harness } from "./harness";

// Ticket types (and the rule that a ticket is classified before it is
// resolved), creator-as-owner with an owner change log, and personal AI keys.

let h: Harness;
let productId: string;

beforeEach(async () => {
  h = await createHarness({ AI_KEY_SECRET: "test-ai-master" });
  productId = await seedProduct(h.db);
  await h.request("ADMIN", "PUT", "/options/faultType", { values: ["Offline", "Screen fault"] });
});
afterEach(async () => {
  setAiFetch(null);
  await h.close();
});

const create = async (as: "SERVICE" | "SALES" | "ADMIN", extra: Record<string, unknown> = {}) =>
  (await h.request(as, "POST", "/tickets", { customerCompany: "ACME", orderNo: "PO-1", contactName: "Li", contactInfo: "x", productId, answers: {}, ...extra })).body.id as string;
const ticketOf = async (id: string) => (await h.request("SERVICE", "GET", `/tickets/${id}`)).body;
const notes = async (id: string) => (await ticketOf(id)).updates.filter((u: any) => u.kind === "NOTE").map((u: any) => u.note);

describe("creator owns the ticket", () => {
  it("after-sales become the after-sales owner, sales the sales owner, unless someone else is named", async () => {
    expect((await ticketOf(await create("SERVICE"))).ticket).toMatchObject({ assignedServiceId: h.users.SERVICE.id, assignedSalesId: null });
    expect((await ticketOf(await create("SALES"))).ticket).toMatchObject({ assignedSalesId: h.users.SALES.id, assignedServiceId: null });
    expect((await ticketOf(await create("SERVICE", { assignedServiceId: h.users.ADMIN.id }))).ticket.assignedServiceId).toBe(h.users.ADMIN.id);
  });

  it("a customer's submission through a link is owned by the people on the link, else its creator", async () => {
    const link = await h.request("ADMIN", "POST", "/ticket-links", { customerCompany: "ACME", orderNo: "PO-9", assignedSalesId: h.users.SALES.id });
    expect(link.status).toBe(200);
    const sent = await h.request(null, "POST", "/public/tickets", { token: link.body.token, contactName: "Ana", contactInfo: "a@x", productId, answers: {} });
    expect(sent.status).toBe(200);
    const row = await h.db.prepare("SELECT assignedSalesId, assignedServiceId FROM tickets WHERE ticketNo = ?").bind(sent.body.ticketNo).first<any>();
    expect(row).toEqual({ assignedSalesId: h.users.SALES.id, assignedServiceId: h.users.ADMIN.id });
  });

  it("any after-sales can change the owner, and every change is logged", async () => {
    const id = await create("SERVICE");
    expect((await h.request("SERVICE", "PATCH", `/tickets/${id}/assign`, { assignedServiceId: h.users.ADMIN.id })).status).toBe(200);
    expect((await ticketOf(id)).ticket.assignedServiceId).toBe(h.users.ADMIN.id);
    expect(await notes(id)).toContain("After-sales owner: Test SERVICE → Test ADMIN (changed by Test SERVICE)");

    // No change, no entry; an unknown user is refused; sales cannot move the after-sales side.
    await h.request("SERVICE", "PATCH", `/tickets/${id}/assign`, { assignedServiceId: h.users.ADMIN.id });
    expect((await notes(id)).filter((n: string) => n.startsWith("After-sales owner"))).toHaveLength(1);
    expect((await h.request("SERVICE", "PATCH", `/tickets/${id}/assign`, { assignedServiceId: "usr_nobody" })).status).toBe(400);
    expect((await h.request("SALES", "PATCH", `/tickets/${id}/assign`, { assignedServiceId: h.users.SALES.id })).status).toBe(400);
    await h.request("SALES", "PATCH", `/tickets/${id}/assign`, { assignedSalesId: h.users.SALES.id });
    expect(await notes(id)).toContain("Sales owner: (none) → Test SALES (changed by Test SALES)");
  });
});

describe("ticket type", () => {
  it("after-sales classify tickets; only faults keep a fault type", async () => {
    const id = await create("SERVICE");
    expect((await h.request("SALES", "PATCH", `/tickets/${id}/type`, { ticketType: "OTHER" })).status).toBe(403);
    expect((await h.request("SERVICE", "PATCH", `/tickets/${id}/type`, { ticketType: "BUG" })).status).toBe(400);

    await h.request("SERVICE", "PATCH", `/tickets/${id}/fault`, { faultType: "Offline" });
    expect((await ticketOf(id)).ticket).toMatchObject({ ticketType: "FAULT", faultType: "Offline" });

    expect((await h.request("SERVICE", "PATCH", `/tickets/${id}/type`, { ticketType: "PRODUCT_REQUEST", summary: " Wants OCPP 2.0.1 " })).status).toBe(200);
    expect((await ticketOf(id)).ticket).toMatchObject({ ticketType: "PRODUCT_REQUEST", faultType: null, faultConfirmedById: null, summary: "Wants OCPP 2.0.1" });
    expect(await notes(id)).toContain("Ticket type: Product request");

    const listed = (await h.request("SALES", "GET", "/tickets?ticketType=PRODUCT_REQUEST")).body;
    expect(listed.map((t: any) => t.id)).toEqual([id]);
  });

  it("a ticket must be classified, and a fault confirmed, before it is resolved", async () => {
    const id = await create("SERVICE");
    await h.request("SERVICE", "PATCH", `/tickets/${id}/status`, { status: "IN_PROGRESS" });
    const noType = await h.request("SERVICE", "PATCH", `/tickets/${id}/status`, { status: "RESOLVED" });
    expect(noType).toMatchObject({ status: 400, body: { error: "Choose the ticket type before resolving it." } });
    await h.request("SERVICE", "PATCH", `/tickets/${id}/type`, { ticketType: "FAULT" });
    expect((await h.request("SERVICE", "PATCH", `/tickets/${id}/status`, { status: "RESOLVED" })).body.error).toBe("Confirm the fault type before resolving it.");
    await h.request("SERVICE", "PATCH", `/tickets/${id}/fault`, { faultType: "Screen fault" });
    expect((await h.request("SERVICE", "PATCH", `/tickets/${id}/status`, { status: "RESOLVED" })).status).toBe(200);
  });
});

describe("personal AI keys", () => {
  let aiCalls: { url: string; auth: string; model: string }[];
  let accept: boolean;
  beforeEach(() => {
    aiCalls = [];
    accept = true;
    setAiFetch((async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      aiCalls.push({ url, auth: (init.headers as Record<string, string>).Authorization, model: body.model });
      return accept
        ? new Response(JSON.stringify({ choices: [{ message: { content: '{"ok": true}' } }] }))
        : new Response('{"error":{"message":"Incorrect API key provided"}}', { status: 401 });
    }) as unknown as typeof fetch);
  });

  it("checks a key before saving it, stores it encrypted and only ever shows it masked", async () => {
    accept = false;
    const rejected = await h.request("SERVICE", "PUT", "/me/ai", { provider: "QWEN", apiKey: "sk-bad-key-0000" });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).not.toContain("sk-bad-key-0000");
    expect((await h.request("SERVICE", "GET", "/me/ai")).body.setting).toBeNull();

    accept = true;
    const saved = await h.request("SERVICE", "PUT", "/me/ai", { provider: "DEEPSEEK", apiKey: "sk-real-key-4321" });
    expect(saved.body).toEqual({ ok: true, maskedKey: "sk-****4321" });
    expect(aiCalls.at(-1)).toMatchObject({ url: "https://api.deepseek.com/chat/completions", auth: "Bearer sk-real-key-4321", model: "deepseek-flash" });

    const shown = await h.request("SERVICE", "GET", "/me/ai");
    expect(shown.body.setting).toMatchObject({ provider: "DEEPSEEK", maskedKey: "sk-****4321", model: null });
    expect(shown.body.feishuLinked).toBe(false);
    await h.db.prepare("UPDATE users SET feishuOpenId = 'ou_x' WHERE id = ?").bind(h.users.SERVICE.id).run();
    expect((await h.request("SERVICE", "GET", "/me/ai")).body.feishuLinked).toBe(true);
    expect(JSON.stringify(shown.body)).not.toContain("sk-real-key-4321");
    const row = await h.db.prepare("SELECT * FROM userAiSettings WHERE userId = ?").bind(h.users.SERVICE.id).first<any>();
    expect(JSON.stringify(row)).not.toContain("real-key");

    // Changing only the model keeps (and re-checks) the saved key.
    expect((await h.request("SERVICE", "PUT", "/me/ai", { provider: "DEEPSEEK", model: "deepseek-v4-pro" })).status).toBe(200);
    expect(aiCalls.at(-1)).toMatchObject({ auth: "Bearer sk-real-key-4321", model: "deepseek-v4-pro" });
    // Switching provider needs a new key.
    expect((await h.request("SERVICE", "PUT", "/me/ai", { provider: "QWEN" })).body.error).toBe("Enter your API key.");
    expect((await h.request("SERVICE", "POST", "/me/ai/test")).status).toBe(200);

    expect((await h.request("SERVICE", "PUT", "/me/ai", { provider: "OFF" })).status).toBe(200);
    expect((await h.request("SERVICE", "GET", "/me/ai")).body.setting).toBeNull();
  });

  it("a key belongs to its user: copying it onto another user's row does not work", async () => {
    await h.request("SERVICE", "PUT", "/me/ai", { provider: "QWEN", apiKey: "sk-service-only-1" });
    expect(await loadUserAiConfig(h.env, h.users.ADMIN.id)).toBeNull();
    expect(await loadUserAiConfig(h.env, h.users.SERVICE.id)).toMatchObject({ provider: "QWEN", apiKey: "sk-service-only-1" });
    await h.db
      .prepare(
        `INSERT INTO userAiSettings (userId, provider, apiKeyCipher, apiKeyIv, apiKeyLast4)
         SELECT ?, provider, apiKeyCipher, apiKeyIv, apiKeyLast4 FROM userAiSettings WHERE userId = ?`
      )
      .bind(h.users.ADMIN.id, h.users.SERVICE.id)
      .run();
    expect(await loadUserAiConfig(h.env, h.users.ADMIN.id)).toBeNull();
  });

  it("is refused without the server secret, and closed to commerce", async () => {
    h.env.AI_KEY_SECRET = undefined;
    expect((await h.request("SERVICE", "GET", "/me/ai")).body.available).toBe(false);
    expect((await h.request("SERVICE", "PUT", "/me/ai", { provider: "QWEN", apiKey: "sk-whatever-1" })).status).toBe(400);
    expect((await h.request("COMMERCE", "GET", "/me/ai")).status).toBe(403);
  });
});

describe("migration 0015", () => {
  it("marks tickets that already have a confirmed fault as faults", async () => {
    const { db, close } = await createD1();
    try {
      await applyMigrations(db, (f) => f < "0015");
      await db.prepare("INSERT INTO tickets (id, ticketNo, seq, status, contactName, contactInfo, faultType) VALUES ('t1', 'TK-1', 1, 'NEW', 'a', 'b', 'Offline')").run();
      await db.prepare("INSERT INTO tickets (id, ticketNo, seq, status, contactName, contactInfo) VALUES ('t2', 'TK-2', 2, 'NEW', 'a', 'b')").run();
      await applyMigrations(db, (f) => f.startsWith("0015"));
      const rows = await db.prepare("SELECT id, ticketType FROM tickets ORDER BY id").all<any>();
      expect(rows.results).toEqual([{ id: "t1", ticketType: "FAULT" }, { id: "t2", ticketType: null }]);
    } finally {
      await close();
    }
  });
});
