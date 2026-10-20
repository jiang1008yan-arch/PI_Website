import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setPiBotFetch } from "../lib/feishu/piBot/client";
import { planApprove, runTransition, WorkflowConflictError } from "../lib/piWorkflow";
import type { AppUser, Role } from "../lib/types";
import { createHarness, seedProduct, type Harness } from "./harness";

// Approver picks (presales + commerce chosen by sales), the concurrency guard,
// the PI Assistant Feishu bot (cards to the picked approvers, Approve / Reject
// from the card) and "Sign in with Feishu" — against a fake Feishu Open API.

type Call = { method: string; path: string; body: any };

let h: Harness;
let calls: Call[];
let nextId: number;
let productId: string;
let presales: AppUser;
let otherPresales: AppUser;
let commerce: AppUser;
let otherCommerce: AppUser;

function fakeFeishu(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace("/open-apis", "") + url.search;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method: init?.method ?? "GET", path, body });
    const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
    if (path.startsWith("/auth/v3/tenant_access_token")) return json({ code: 0, tenant_access_token: "t-1", expire: 7200 });
    if (path.startsWith("/authen/v2/oauth/token")) return json({ code: 0, access_token: "u-1" });
    if (path.startsWith("/authen/v1/user_info")) return json({ code: 0, data: { union_id: "on_pat", open_id: "ou_pat", name: "Pat" } });
    return json({ code: 0, data: { message_id: `om_${++nextId}` } });
  }) as typeof fetch;
}

async function addUser(id: string, role: Role, unionId: string | null = null): Promise<AppUser> {
  await h.db
    .prepare("INSERT INTO users (id, username, passwordHash, displayName, role, feishuUnionId) VALUES (?, ?, 'x', ?, ?, ?)")
    .bind(id, id, id.toUpperCase(), role, unionId)
    .run();
  return { id, username: id, displayName: id.toUpperCase(), role };
}

const item = { productId: "", quantity: 2, unitPrice: 100, discountPct: 0, fieldValues: [] };

async function zhDraft(productionOrderNo = "SO-1") {
  const res = await h.request("SALES", "POST", "/pi", {
    language: "ZH",
    customerCompany: "ACME",
    productionOrderNo,
    items: [{ ...item, productId }]
  });
  expect(res.status).toBe(200);
  return res.body.id as string;
}

const status = async (piId: string) =>
  (await h.db.prepare("SELECT status FROM pi WHERE id=?").bind(piId).first<{ status: string }>())?.status;
const sentCards = () => calls.filter((c) => c.method === "POST" && c.path.startsWith("/im/v1/messages?receive_id_type=union_id") && c.body.msg_type === "interactive");
const cardTitle = (c: Call) => JSON.parse(c.body.content).header.title.content as string;
const piEvent = (unionId: string, value: Record<string, unknown>, form: Record<string, string> = {}, eventId = `ev_${Math.random()}`) =>
  h.raw(
    "POST",
    "/feishu/pi/events",
    JSON.stringify({
      schema: "2.0",
      header: { event_id: eventId, token: "pi-vt", event_type: "card.action.trigger" },
      event: { operator: { union_id: unionId }, action: { value, form_value: form, tag: "button" } }
    })
  );

beforeEach(async () => {
  h = await createHarness({
    FEISHU_PI_APP_ID: "cli_pi",
    FEISHU_PI_APP_SECRET: "secret",
    FEISHU_PI_VERIFICATION_TOKEN: "pi-vt",
    APP_BASE_URL: "https://portal.example"
  });
  calls = [];
  nextId = 0;
  setPiBotFetch(fakeFeishu());
  productId = await seedProduct(h.db);
  presales = await addUser("pre1", "PRESALES", "on_pre1");
  otherPresales = await addUser("pre2", "PRESALES");
  commerce = await addUser("com1", "COMMERCE", "on_com1");
  otherCommerce = await addUser("com2", "COMMERCE", "on_com2");
  await h.db.prepare("UPDATE users SET feishuUnionId='on_sales' WHERE id=?").bind(h.users.SALES.id).run();
});

afterEach(async () => {
  // Let deferred notifications finish against the fake before tearing down, so
  // none outlives the test (or reaches the real Feishu).
  await h.settle();
  setPiBotFetch(null);
  await h.close();
});

describe("approver picks", () => {
  it("only the picked presales user (or an admin) confirms; only the picked commerce user decides", async () => {
    const zhId = await zhDraft();
    const submit = await h.request("SALES", "POST", `/pi/${zhId}/submit-for-review`, { assignedToId: presales.id, commerceId: commerce.id });
    expect(submit.status).toBe(200);

    expect((await h.request(presales, "GET", "/pi/review-queue")).body.map((p: any) => p.id)).toEqual([zhId]);
    expect((await h.request(otherPresales, "GET", "/pi/review-queue")).body).toEqual([]);
    expect((await h.request(otherPresales, "POST", `/pi/${zhId}/approve`, {})).status).toBe(403);
    expect((await h.request("SALES", "GET", "/pi/review-queue")).status).toBe(403);

    // The picked presales user edits in review mode and confirms.
    expect((await h.request(presales, "GET", `/pi/${zhId}`)).status).toBe(200);
    const confirm = await h.request(presales, "POST", `/pi/${zhId}/approve`, { pi: { deliveryDate: "2026-12-01" }, items: [{ ...item, productId }] });
    expect(confirm.status).toBe(200);
    expect(await status(zhId)).toBe("PENDING_COMMERCE");
    const row = await h.db.prepare("SELECT deliveryDate FROM pi WHERE id=?").bind(zhId).first<{ deliveryDate: string }>();
    expect(row?.deliveryDate).toBe("2026-12-01");

    expect((await h.request(commerce, "GET", "/pi/commerce-queue")).body.map((p: any) => p.id)).toEqual([zhId]);
    expect((await h.request(otherCommerce, "GET", "/pi/commerce-queue")).body).toEqual([]);
    expect((await h.request(otherCommerce, "POST", `/pi/${zhId}/commerce-approve`, {})).status).toBe(403);
    expect((await h.request(commerce, "POST", `/pi/${zhId}/commerce-approve`, {})).status).toBe(200);
    expect(await status(zhId)).toBe("APPROVED");
  });

  it("rejects picks with the wrong role", async () => {
    const zhId = await zhDraft();
    expect((await h.request("SALES", "POST", `/pi/${zhId}/submit-for-review`, { assignedToId: commerce.id })).status).toBe(400);
    expect((await h.request("SALES", "POST", `/pi/${zhId}/submit-for-review`, { commerceId: presales.id })).status).toBe(400);
    expect(await status(zhId)).toBe("DRAFT");
  });

  it("without picks the old behaviour holds: any admin confirms, any commerce user decides", async () => {
    const zhId = await zhDraft();
    await h.request("SALES", "POST", `/pi/${zhId}/submit-for-review`, {});
    expect((await h.request(presales, "POST", `/pi/${zhId}/approve`, {})).status).toBe(403);
    expect((await h.request("ADMIN", "POST", `/pi/${zhId}/approve`, {})).status).toBe(200);
    expect((await h.request(otherCommerce, "POST", `/pi/${zhId}/commerce-approve`, {})).status).toBe(200);
  });
});

describe("concurrency guard", () => {
  it("a transition planned from a stale row rolls back entirely", async () => {
    const zhId = await zhDraft();
    await h.request("SALES", "POST", `/pi/${zhId}/submit-for-review`, {});
    const stale = await h.db.prepare("SELECT * FROM pi WHERE id=?").bind(zhId).first<any>();
    expect((await h.request("ADMIN", "POST", `/pi/${zhId}/approve`, {})).status).toBe(200);

    const events = async () => (await h.db.prepare("SELECT COUNT(*) AS n FROM piReviewEvents WHERE piId=?").bind(zhId).first<{ n: number }>())?.n;
    const before = await events();
    await expect(runTransition(h.db, zhId, planApprove(stale, { pi: { customerCompany: "LATE" } }), h.users.ADMIN.id)).rejects.toBeInstanceOf(
      WorkflowConflictError
    );
    expect(await events()).toBe(before);
    const row = await h.db.prepare("SELECT status, customerCompany FROM pi WHERE id=?").bind(zhId).first<any>();
    expect(row).toEqual({ status: "PENDING_COMMERCE", customerCompany: "ACME" });
  });
});

describe("PI Assistant bot", () => {
  it("sends each step's card to the picked approver and closes earlier cards", async () => {
    const zhId = await zhDraft("SO-77");
    await h.request("SALES", "POST", `/pi/${zhId}/submit-for-review`, { assignedToId: presales.id, commerceId: commerce.id });
    await h.settle();
    let cards = sentCards();
    expect(cards.map((c) => c.body.receive_id)).toEqual(["on_pre1"]);
    expect(cardTitle(cards[0])).toBe("PI SO-77 · Presales approval needed");

    await h.request(presales, "POST", `/pi/${zhId}/approve`, {});
    await h.settle();
    cards = sentCards();
    expect(cards.map((c) => c.body.receive_id)).toEqual(["on_pre1", "on_com1"]);
    expect(cardTitle(cards[1])).toBe("PI SO-77 · Commerce approval needed");
    const patched = calls.filter((c) => c.method === "PATCH");
    expect(patched.map((c) => c.path)).toEqual(["/im/v1/messages/om_1"]);
    expect(JSON.parse(patched[0].body.content).header.title.content).toContain("Approved by PRE1 (Presales)");
  });

  it("approve and reject from the card, as the linked user; repeats and stale cards are harmless", async () => {
    const zhId = await zhDraft("SO-88");
    await h.request("SALES", "POST", `/pi/${zhId}/submit-for-review`, { assignedToId: presales.id, commerceId: commerce.id });
    await h.settle();

    // Unlinked Feishu users and the wrong approver are refused.
    expect((await piEvent("on_stranger", { action: "pi_approve", piId: zhId, status: "PENDING_REVIEW" })).body.toast.type).toBe("error");
    expect((await piEvent("on_com1", { action: "pi_approve", piId: zhId, status: "PENDING_REVIEW" })).body.toast.type).toBe("error");

    const approve = await piEvent("on_pre1", { action: "pi_approve", piId: zhId, status: "PENDING_REVIEW" }, {}, "ev_same");
    expect(approve.status).toBe(200);
    expect(approve.body.toast).toEqual({ type: "success", content: "Approved — sent to Commerce." });
    expect(approve.body.card.data.header.title.content).toContain("Approved by PRE1 (Presales)");
    expect(await status(zhId)).toBe("PENDING_COMMERCE");

    // Feishu redelivers the same event: ignored.
    expect((await piEvent("on_pre1", { action: "pi_approve", piId: zhId, status: "PENDING_REVIEW" }, {}, "ev_same")).body).toEqual({});
    // An old presales card pressed again: already handled.
    expect((await piEvent("on_pre1", { action: "pi_approve", piId: zhId, status: "PENDING_REVIEW" })).body.toast.content).toBe(
      "This PI was already handled."
    );

    // Commerce rejects from the card: needs a reason.
    expect((await piEvent("on_com1", { action: "pi_reject", piId: zhId, status: "PENDING_COMMERCE" })).body.toast.type).toBe("error");
    const reject = await piEvent("on_com1", { action: "pi_reject", piId: zhId, status: "PENDING_COMMERCE" }, { reason: "Price too low" });
    expect(reject.body.toast.content).toBe("Rejected — sent back to the submitter.");
    await h.settle();
    const pi = await h.db.prepare("SELECT status, rejectionNote FROM pi WHERE id=?").bind(zhId).first<any>();
    expect(pi).toEqual({ status: "REJECTED", rejectionNote: "Price too low" });

    // The submitter gets a red notice.
    const notice = sentCards().find((c) => c.body.receive_id === "on_sales");
    expect(notice && JSON.parse(notice.body.content).header.template).toBe("red");
  });

  it("refuses pushes with a wrong verification token", async () => {
    const res = await h.raw("POST", "/feishu/pi/events", JSON.stringify({ header: { event_id: "x", token: "nope", event_type: "card.action.trigger" }, event: {} }));
    expect(res.status).toBe(401);
  });
});

describe("Sign in with Feishu", () => {
  it("first time links via a password sign-in; afterwards signs straight in", async () => {
    const start = await h.raw("GET", "/auth/feishu/start?next=%2Fpi%2Fzh", "");
    expect(start.status).toBe(302);

    const state = async () => {
      const res = await h.fetchAs("SALES", "GET", "/auth/feishu/start?next=%2Fpi%2Fzh");
      return new URL(res.headers.get("location")!).searchParams.get("state")!;
    };
    const callback = async () => {
      const res = await h.fetchAs("SALES", "GET", `/auth/feishu/callback?code=c1&state=${encodeURIComponent(await state())}`);
      return new URL(res.headers.get("location")!.replace("#", "?"));
    };

    // Not linked yet: a bind token comes back; signing in with it links on_pat.
    const first = await callback();
    const bind = first.searchParams.get("feishuBind")!;
    expect(bind).toBeTruthy();
    await h.db.prepare("UPDATE users SET passwordHash=? WHERE id=?").bind(await hashOf("Pass1234"), presales.id).run();
    const login = await h.raw("POST", "/auth/login", JSON.stringify({ username: presales.username, password: "Pass1234", feishuBindToken: bind }));
    expect(login.status).toBe(200);
    expect((await h.db.prepare("SELECT feishuUnionId FROM users WHERE id=?").bind(presales.id).first<any>()).feishuUnionId).toBe("on_pat");

    // Linked: the callback hands back a session token and the destination.
    const second = await callback();
    expect(second.searchParams.get("feishuToken")).toBeTruthy();
    expect(second.searchParams.get("next")).toBe("/pi/zh");

    // A bind token is not a session token.
    expect((await h.raw("GET", "/pi", "", { authorization: `Bearer ${bind}` })).status).toBe(401);
  });
});

async function hashOf(password: string) {
  const { hashPassword } = await import("../lib/auth");
  return hashPassword(password);
}
