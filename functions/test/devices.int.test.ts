import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setFeishuFetch } from "../lib/feishu/client";
import { runScheduledJobs } from "../scheduled";
import { createHarness, type Harness } from "./harness";

// Device status pushed by the charger backend: token check, alerts in the
// after-sales group, ticket creation from an alert, offline timeouts, and the
// Device monitoring view.

type Call = { method: string; path: string; body: any };
let h: Harness;
let calls: Call[];
let nextId: number;
const SERVICE_CHAT = "oc_service";
const TOKEN = { "x-device-token": "device-secret" };

beforeEach(async () => {
  h = await createHarness({
    FEISHU_APP_ID: "cli_test",
    FEISHU_APP_SECRET: "secret",
    FEISHU_VERIFICATION_TOKEN: "vt",
    FEISHU_SERVICE_CHAT_ID: SERVICE_CHAT,
    APP_BASE_URL: "https://portal.example",
    DEVICE_INGEST_SECRET: "device-secret"
  });
  calls = [];
  nextId = 0;
  setFeishuFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace("/open-apis", "") + url.search;
    calls.push({ method: init?.method ?? "GET", path, body: init?.body ? JSON.parse(String(init.body)) : null });
    const json = (data: unknown) => new Response(JSON.stringify(data));
    if (path.startsWith("/auth/")) return json({ code: 0, tenant_access_token: "t", expire: 7200 });
    return json({ code: 0, data: { message_id: `om_${++nextId}` } });
  }) as typeof fetch);
  await h.db.prepare("UPDATE users SET feishuOpenId = 'ou_service' WHERE id = ?").bind(h.users.SERVICE.id).run();
  await h.db
    .prepare(
      `INSERT INTO pi (id, piNo, seq, date, language, status, customerCompany, productionOrderNo, createdById, approvedAt)
       VALUES ('pi_a', 'ZH-001', 1, '2026-10-01', 'ZH', 'APPROVED', 'Iberia Charge SL', 'PO-2026-0901', ?, CURRENT_TIMESTAMP)`
    )
    .bind(h.users.SALES.id)
    .run();
  await h.db.prepare("INSERT INTO devices (id, serialNumber, piId, createdById) VALUES ('d1', 'CHG-0901-0001', 'pi_a', ?)").bind(h.users.SERVICE.id).run();
});
afterEach(async () => {
  setFeishuFetch(null);
  await h.close();
});

const push = (body: unknown, headers: Record<string, string> = TOKEN) => h.raw("POST", "/devices/status", JSON.stringify(body), headers);
// Device alert cards in the after-sales group (not e.g. the weekly summary).
const groupCards = () =>
  calls.filter((c) => c.path.includes("receive_id_type=chat_id") && c.body?.receive_id === SERVICE_CHAT && c.body.msg_type === "interactive" && c.body.content.includes("Device alert"));
const card = (call: Call) => JSON.parse(call.body.content);
const cardAction = (value: Record<string, string>, form: Record<string, string> = {}, messageId = "om_1") =>
  h.raw(
    "POST",
    "/feishu/card",
    JSON.stringify({
      schema: "2.0",
      header: { event_id: `ev_${Math.random()}`, token: "vt", event_type: "card.action.trigger" },
      event: { operator: { open_id: "ou_service" }, action: { value, form_value: form }, context: { open_message_id: messageId } }
    })
  );

describe("device status intake", () => {
  it("needs the shared token and reports bad events without dropping good ones", async () => {
    expect((await push({ serialNumber: "CHG-0901-0001", status: "ONLINE" }, {})).status).toBe(401);
    expect((await push({ serialNumber: "CHG-0901-0001", status: "ONLINE" }, { "x-device-token": "nope" })).status).toBe(401);
    const res = await push({ events: [{ serialNumber: "CHG-0901-0001", status: "ONLINE" }, { serialNumber: "x", status: "ONLINE" }, { serialNumber: "CHG-2", status: "MAYBE" }] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ accepted: 1, alerts: 0 });
    expect(res.body.rejected.map((r: any) => r.index)).toEqual([1, 2]);
  });

  it("a fault posts one alert card with the device's PI context; whoever creates the ticket owns it", async () => {
    const res = await push([
      { serialNumber: "CHG-0901-0001", status: "FAULT", faultCode: "E12", faultText: "RCD tripped", occurredAt: "2026-10-20T08:00:00Z" },
      { serialNumber: "CHG-0901-0001", status: "FAULT", faultCode: "E12", occurredAt: "2026-10-20T08:05:00Z" }
    ]);
    expect(res.body).toMatchObject({ accepted: 2, alerts: 1 });
    expect(groupCards()).toHaveLength(1);
    const alert = card(groupCards()[0]);
    expect(alert.header.title.content).toContain("CHG-0901-0001");
    const text = JSON.stringify(alert);
    expect(text).toContain("E12");
    expect(text).toContain("Iberia Charge SL");
    expect(text).toContain("PO-2026-0901");
    const draftId = alert.body.elements.find((e: any) => e.tag === "button").behaviors[0].value.draftId;

    // Pressing it opens the usual form, starting from the SN, order and customer.
    calls = [];
    await cardAction({ action: "open_draft", draftId }, {}, "om_1");
    await h.settle();
    const form = JSON.parse(calls.find((c) => c.method === "PATCH" && c.path === "/im/v1/messages/om_1")!.body.content);
    const inputs = Object.fromEntries(form.body.elements.find((e: any) => e.tag === "form").elements.filter((e: any) => e.tag === "input").map((e: any) => [e.name, e.default_value]));
    expect(inputs).toMatchObject({ orderNo: "PO-2026-0901", customerCompany: "Iberia Charge SL" });
    expect(JSON.stringify(form)).toContain("Device SN:** CHG-0901-0001");

    const created = await cardAction({ action: "confirm_draft", draftId }, { contactName: "Site manager", orderNo: "PO-2026-0901", customerCompany: "Iberia Charge SL" }, "om_1");
    expect(created.body.toast.type).toBe("success");
    await h.settle();
    const ticket = await h.db.prepare("SELECT id, serialNumber, assignedServiceId, feishuSourceChatId FROM tickets").first<any>();
    expect(ticket).toMatchObject({ serialNumber: "CHG-0901-0001", assignedServiceId: h.users.SERVICE.id, feishuSourceChatId: null });
    const monitor = await h.request("SERVICE", "GET", "/devices/monitor");
    expect(monitor.body.alerts[0]).toMatchObject({ serialNumber: "CHG-0901-0001", alertKind: "FAULT", alertTicketId: ticket.id, customerCompany: "Iberia Charge SL" });
    expect(monitor.body.events).toHaveLength(2);
    expect((await h.request("SALES", "GET", "/devices/monitor")).status).toBe(403);

    // Back online closes the alert; a later fault alerts again.
    await push({ serialNumber: "CHG-0901-0001", status: "ONLINE", occurredAt: "2026-10-20T09:00:00Z" });
    expect((await h.request("SERVICE", "GET", "/devices/monitor")).body.alerts).toEqual([]);
    calls = [];
    expect((await push({ serialNumber: "CHG-0901-0001", status: "FAULT", faultCode: "E7", occurredAt: "2026-10-20T10:00:00Z" })).body.alerts).toBe(1);
  });

  it("a device offline for two hours is alerted by the scheduled job, once; unregistered SNs are flagged", async () => {
    const wentOffline = new Date(Date.now() - 3 * 3600_000).toISOString();
    await push({ serialNumber: "UNKNOWN-77", status: "OFFLINE", occurredAt: wentOffline });
    expect(groupCards()).toHaveLength(0);
    await runScheduledJobs(h.env, new Date());
    expect(groupCards()).toHaveLength(1);
    expect(JSON.stringify(card(groupCards()[0]))).toContain("not registered on any PI");
    await runScheduledJobs(h.env, new Date());
    expect(groupCards()).toHaveLength(1);
    // Alert requests do not expire like chat requests.
    const draft = await h.db.prepare("SELECT kind, expiredAt FROM feishuDrafts").first<any>();
    expect(draft).toEqual({ kind: "DEVICE_ALERT", expiredAt: null });
  });
});
