import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setFeishuFetch } from "../lib/feishu/client";
import { groupReminders, weeklySummaryKey } from "../lib/feishu/digest";
import { isDraftExpired } from "../lib/feishu/ticketRequest";
import { runScheduledJobs } from "../scheduled";
import { createHarness, seedProduct, type Harness } from "./harness";

// The scheduled jobs the cron Worker triggers: owner reminders, the weekly
// group summary and expiry of unanswered Feishu requests.

type Call = { method: string; path: string; body: any };
let h: Harness;
let calls: Call[];
let nextId: number;
const SERVICE_CHAT = "oc_service";

const sql = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
const hoursAgo = (now: Date, h: number) => sql(new Date(now.getTime() - h * 3600_000));

beforeEach(async () => {
  h = await createHarness({
    FEISHU_APP_ID: "cli_test",
    FEISHU_APP_SECRET: "secret",
    FEISHU_VERIFICATION_TOKEN: "vt",
    FEISHU_SERVICE_CHAT_ID: SERVICE_CHAT,
    APP_BASE_URL: "https://portal.example",
    CRON_SECRET: "cron-secret"
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
});
afterEach(async () => {
  setFeishuFetch(null);
  await h.close();
});

const sent = (filter: (c: Call) => boolean) => calls.filter((c) => c.path.startsWith("/im/v1/messages") && filter(c));

describe("the cron endpoint", () => {
  it("needs the shared secret", async () => {
    expect((await h.raw("POST", "/internal/cron", "")).status).toBe(401);
    expect((await h.raw("POST", "/internal/cron", "", { "x-cron-secret": "wrong" })).status).toBe(401);
    const ok = await h.raw("POST", "/internal/cron", "", { "x-cron-secret": "cron-secret" });
    expect(ok.status).toBe(200);
    expect(Object.keys(ok.body.jobs)).toEqual(["purgeExpired", "feishuOutbox", "expireDrafts", "draftFiles", "ownerReminders", "weeklySummary", "deviceOffline"]);
    h.env.CRON_SECRET = undefined;
    expect((await h.raw("POST", "/internal/cron", "", { "x-cron-secret": "" })).status).toBe(401);
  });
});

describe("owner reminders", () => {
  it("one message per owner for tickets not updated for a day, at most once a day", async () => {
    const productId = await seedProduct(h.db);
    const make = async () => (await h.request("SERVICE", "POST", "/tickets", { customerCompany: "ACME", contactName: "Li", contactInfo: "x", productId, answers: {} })).body.id;
    const [stale1, stale2, fresh] = [await make(), await make(), await make()];
    await h.settle();
    const now = new Date("2026-10-21T02:00:00Z");
    await h.db.prepare("UPDATE tickets SET updatedAt = ? WHERE id IN (?, ?)").bind(hoursAgo(now, 30), stale1, stale2).run();
    await h.db.prepare("UPDATE tickets SET updatedAt = ? WHERE id = ?").bind(hoursAgo(now, 3), fresh).run();
    calls = [];

    await runScheduledJobs(h.env, now);
    const reminders = sent((c) => c.body?.receive_id === "ou_service" && c.body.msg_type === "text");
    expect(reminders).toHaveLength(1);
    const text = JSON.parse(reminders[0].body.content).text;
    expect(text).toContain("these 2 tickets");
    expect(text).toContain("https://portal.example/tickets/");

    calls = [];
    await runScheduledJobs(h.env, new Date(now.getTime() + 2 * 3600_000));
    expect(sent((c) => c.body?.msg_type === "text")).toHaveLength(0); // already reminded today
    calls = [];
    await runScheduledJobs(h.env, new Date(now.getTime() + 25 * 3600_000));
    expect(JSON.parse(sent((c) => c.body?.receive_id === "ou_service" && c.body.msg_type === "text")[0].body.content).text).toContain("these 3 tickets");
  });

  it("groups and words the reminder", () => {
    const now = new Date("2026-10-21T00:00:00Z");
    const rows = [
      { id: "a", ticketNo: "TK-A", customerCompany: "X", updatedAt: "2026-10-18 00:00:00", ownerId: "u1", ownerUnionId: "on_1", ownerOpenId: "ou_1" },
      { id: "b", ticketNo: "TK-B", customerCompany: "", updatedAt: "2026-10-19 20:00:00", ownerId: "u2", ownerUnionId: null, ownerOpenId: "ou_2" }
    ];
    const msgs = groupReminders(rows, now, null);
    expect(msgs.map((m) => m.target)).toEqual([{ type: "union_id", id: "on_1" }, { type: "open_id", id: "ou_2" }]);
    expect(msgs[0].text).toContain("TK-A (X): no update for 3 days");
    expect(msgs[1].text).toContain("TK-B (—): no update for 28 hours");
  });
});

describe("weekly summary", () => {
  it("is due from Monday 9:00 Beijing time, keyed by that Monday", () => {
    expect(weeklySummaryKey(new Date("2026-10-19T00:59:00Z"))).toBeNull(); // Mon 08:59 Beijing
    expect(weeklySummaryKey(new Date("2026-10-19T01:00:00Z"))).toBe("2026-10-19"); // Mon 09:00
    expect(weeklySummaryKey(new Date("2026-10-22T10:00:00Z"))).toBe("2026-10-19"); // Thursday
    expect(weeklySummaryKey(new Date("2026-10-25T17:00:00Z"))).toBeNull(); // Mon 01:00 Beijing, though still Sunday in UTC
    expect(weeklySummaryKey(new Date("2026-10-25T15:00:00Z"))).toBe("2026-10-19"); // Sun 23:00 Beijing
  });

  it("goes to the after-sales group once a week", async () => {
    const productId = await seedProduct(h.db);
    await h.request("SERVICE", "POST", "/tickets", { customerCompany: "ACME", contactName: "Li", contactInfo: "x", productId, answers: {} });
    await h.settle();
    calls = [];
    await runScheduledJobs(h.env, new Date("2026-10-26T00:30:00Z")); // Mon 08:30 Beijing — not yet
    expect(sent((c) => c.body?.receive_id === SERVICE_CHAT)).toHaveLength(0);
    await runScheduledJobs(h.env, new Date("2026-10-26T01:30:00Z"));
    const summary = sent((c) => c.body?.receive_id === SERVICE_CHAT);
    expect(summary).toHaveLength(1);
    const card = JSON.parse(summary[0].body.content);
    expect(card.header.title.content).toContain("week of 2026-10-26");
    expect(JSON.stringify(card)).toContain("Test SERVICE");
    await runScheduledJobs(h.env, new Date("2026-10-26T02:30:00Z"));
    expect(sent((c) => c.body?.receive_id === SERVICE_CHAT)).toHaveLength(1);
  });
});

describe("Feishu request expiry", () => {
  it("greys out requests nothing was added to for six hours, and refuses them afterwards", async () => {
    const now = new Date();
    await h.db
      .prepare("INSERT INTO feishuDrafts (id, requestedBy, sourceChatId, sourceMessageId, text, cardMessageId, createdAt) VALUES ('fdr_old', 'ou_service', 'oc_dm', 'om_src', 'hi', 'om_prompt_old', ?)")
      .bind(hoursAgo(now, 7))
      .run();
    await h.db
      .prepare("INSERT INTO feishuDrafts (id, requestedBy, sourceChatId, sourceMessageId, text, cardMessageId, createdAt) VALUES ('fdr_new', 'ou_admin', 'oc_dm', 'om_src2', 'hi', 'om_prompt_new', ?)")
      .bind(hoursAgo(now, 1))
      .run();
    // Started long ago but added to an hour ago: still open (one per person).
    await h.db
      .prepare("INSERT INTO feishuDrafts (id, requestedBy, sourceChatId, sourceMessageId, text, cardMessageId, createdAt, updatedAt) VALUES ('fdr_busy', 'ou_sales', '', '', 'hi', 'om_prompt_busy', ?, ?)")
      .bind(hoursAgo(now, 9), hoursAgo(now, 1))
      .run();
    // "Add to ticket" left alone for an hour: past its 30 minutes.
    await h.db
      .prepare("INSERT INTO feishuDrafts (id, requestedBy, sourceChatId, sourceMessageId, text, cardMessageId, createdAt, targetTicketId) VALUES ('fdr_add', 'ou_presales', '', '', '', 'om_prompt_add', ?, 't1')")
      .bind(hoursAgo(now, 1))
      .run();
    expect(isDraftExpired({ createdAt: hoursAgo(now, 7) }, now)).toBe(true);
    expect(isDraftExpired({ createdAt: hoursAgo(now, 5) }, now)).toBe(false);
    expect(isDraftExpired({ createdAt: hoursAgo(now, 9), updatedAt: hoursAgo(now, 1) }, now)).toBe(false);

    // Opening the old one is refused and its card greyed out.
    const res = await h.raw(
      "POST",
      "/feishu/card",
      JSON.stringify({
        schema: "2.0",
        header: { event_id: "ev_exp", token: "vt", event_type: "card.action.trigger" },
        event: { operator: { open_id: "ou_service" }, action: { value: { action: "open_draft", draftId: "fdr_old" } }, context: { open_message_id: "om_prompt_old" } }
      })
    );
    expect(res.body.toast.type).toBe("warning");
    await h.settle();
    expect(sent((c) => c.method === "PATCH" && c.path === "/im/v1/messages/om_prompt_old")[0].body.content).toContain("Expired");

    // The scheduled sweep catches the ones nobody touched.
    await h.db.prepare("UPDATE feishuDrafts SET expiredAt = NULL WHERE id = 'fdr_old'").run();
    calls = [];
    await runScheduledJobs(h.env, now);
    const patches = sent((c) => c.method === "PATCH");
    expect(patches.map((c) => c.path).sort()).toEqual(["/im/v1/messages/om_prompt_add", "/im/v1/messages/om_prompt_old"]);
    expect(patches.find((c) => c.path.endsWith("om_prompt_add"))!.body.content).toContain("Not added");
    const rows = await h.db.prepare("SELECT id, expiredAt IS NOT NULL AS expired FROM feishuDrafts ORDER BY id").all<any>();
    expect(rows.results).toEqual([
      { id: "fdr_add", expired: 1 },
      { id: "fdr_busy", expired: 0 },
      { id: "fdr_new", expired: 0 },
      { id: "fdr_old", expired: 1 }
    ]);
  });
});
