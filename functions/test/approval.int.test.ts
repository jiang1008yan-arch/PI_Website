import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { purgeExpired } from "../scheduled";
import { createHarness, seedProduct, type Harness } from "./harness";

// Two-step approval (presales confirmation → commerce approval), revisions of
// approved PIs, retention, and the approved list — through the real routes.

let h: Harness;
let productId: string;
beforeEach(async () => {
  h = await createHarness();
  productId = await seedProduct(h.db);
});
afterEach(async () => {
  await h.close();
});

const item = (quantity: number, unitPrice = 100) => ({ productId, quantity, unitPrice, discountPct: 0, fieldValues: [] });

// An EN PI synced into a linked ZH draft, as the sales workflow does it.
async function createPair(customerCompany = "ACME", productionOrderNo = "PO-001") {
  const en = await h.request("SALES", "POST", "/pi", { language: "EN", customerCompany, items: [item(2)] });
  expect(en.status).toBe(200);
  const sync = await h.request("SALES", "POST", `/pi/${en.body.id}/resync-zh`);
  expect(sync.status).toBe(200);
  const zhId = sync.body.linkedZhId as string;
  expect((await h.request("SALES", "PATCH", `/pi/${zhId}`, { customerCompany, productionOrderNo, items: [item(2)] })).status).toBe(200);
  return { enId: en.body.id as string, zhId };
}

async function approveFully(zhId: string) {
  expect((await h.request("SALES", "POST", `/pi/${zhId}/submit-for-review`, {})).status).toBe(200);
  expect((await h.request("ADMIN", "POST", `/pi/${zhId}/approve`, {})).status).toBe(200);
  expect((await h.request("COMMERCE", "POST", `/pi/${zhId}/commerce-approve`, {})).status).toBe(200);
}

const status = async (piId: string) => (await h.db.prepare("SELECT status FROM pi WHERE id=?").bind(piId).first<{ status: string }>())?.status;

describe("two-step approval", () => {
  it("presales confirmation then commerce approval, each recorded with its step", async () => {
    const { zhId } = await createPair();
    await h.request("SALES", "POST", `/pi/${zhId}/submit-for-review`, {});
    await h.request("ADMIN", "POST", `/pi/${zhId}/approve`, {});
    expect(await status(zhId)).toBe("PENDING_COMMERCE");

    const queue = await h.request("COMMERCE", "GET", "/pi/commerce-queue");
    expect(queue.status).toBe(200);
    expect(queue.body.map((p: any) => p.id)).toEqual([zhId]);

    // ADMIN may watch the queue but never decide; commerce never edits.
    expect((await h.request("ADMIN", "GET", "/pi/commerce-queue")).status).toBe(200);
    expect((await h.request("ADMIN", "POST", `/pi/${zhId}/commerce-approve`, {})).status).toBe(403);
    expect((await h.request("COMMERCE", "PATCH", `/pi/${zhId}`, { customerCompany: "X" })).status).toBe(403);
    expect((await h.request("SALES", "GET", "/pi/commerce-queue")).status).toBe(403);

    expect((await h.request("COMMERCE", "POST", `/pi/${zhId}/commerce-approve`, {})).status).toBe(200);
    expect(await status(zhId)).toBe("APPROVED");

    const view = await h.request("SALES", "GET", `/pi/${zhId}/view`);
    expect(view.body.events.map((e: any) => [e.action, e.step])).toEqual([
      ["SUBMITTED", null],
      ["APPROVED", "PRESALES"],
      ["APPROVED", "COMMERCE"]
    ]);
    const approvedAt = await h.db.prepare("SELECT approvedAt FROM pi WHERE id=?").bind(zhId).first<{ approvedAt: string }>();
    expect(approvedAt?.approvedAt).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  });

  it("commerce rejection needs a reason and sends the PI back to sales, who resubmit from presales", async () => {
    const { zhId } = await createPair();
    await h.request("SALES", "POST", `/pi/${zhId}/submit-for-review`, {});
    await h.request("ADMIN", "POST", `/pi/${zhId}/approve`, {});

    expect((await h.request("COMMERCE", "POST", `/pi/${zhId}/commerce-reject`, { note: "  " })).status).toBe(400);
    expect((await h.request("COMMERCE", "POST", `/pi/${zhId}/commerce-reject`, { note: "Payment term wrong" })).status).toBe(200);
    const after = await h.request("SALES", "GET", `/pi/${zhId}`);
    expect(after.body.pi.status).toBe("REJECTED");
    expect(after.body.pi.rejectionNote).toBe("Payment term wrong");

    expect((await h.request("SALES", "PATCH", `/pi/${zhId}`, { paymentTerm: "T/T 30%" })).status).toBe(200);
    await h.request("SALES", "POST", `/pi/${zhId}/submit-for-review`, {});
    expect(await status(zhId)).toBe("PENDING_REVIEW");
    expect((await h.request("COMMERCE", "POST", `/pi/${zhId}/commerce-approve`, {})).status).toBe(400);
  });

  it("commerce can view and download both languages while deciding; after-sales cannot", async () => {
    const { zhId, enId } = await createPair();
    await h.request("SALES", "POST", `/pi/${zhId}/submit-for-review`, {});
    await h.request("ADMIN", "POST", `/pi/${zhId}/approve`, {});

    const view = await h.request("COMMERCE", "GET", `/pi/${zhId}/view`);
    expect(view.status).toBe(200);
    expect(view.body.zh.current.pi.id).toBe(zhId);
    expect(view.body.en.current.pi.id).toBe(enId);
    expect((await h.request("COMMERCE", "GET", `/pi/${zhId}/export-bundle`)).status).toBe(200);
    expect((await h.request("COMMERCE", "GET", `/pi/${enId}/export-bundle`)).status).toBe(200);

    expect((await h.request("SERVICE", "GET", `/pi/${zhId}/view`)).status).toBe(403);
  });

  it("an approved pair is locked: neither the ZH nor the linked EN PI can be edited or deleted", async () => {
    const { zhId, enId } = await createPair();
    await approveFully(zhId);
    expect((await h.request("SALES", "PATCH", `/pi/${enId}`, { customerCompany: "X" })).status).toBe(400);
    expect((await h.request("SALES", "DELETE", `/pi/${enId}`)).status).toBe(400);
    expect((await h.request("SALES", "PATCH", `/pi/${zhId}`, { customerCompany: "X" })).status).toBe(400);
  });

  it("warns, without blocking, when the production order number is already used", async () => {
    const first = await createPair("ACME", "PO-777");
    await approveFully(first.zhId);
    const second = await createPair("Beta", "PO-777");
    const res = await h.request("SALES", "POST", `/pi/${second.zhId}/submit-for-review`, {});
    expect(res.status).toBe(200);
    expect(res.body.duplicateProductionOrderPiNos).toHaveLength(1);
  });
});

describe("revisions", () => {
  it("keeps the approved version effective until the revision gets commerce approval", async () => {
    const { zhId, enId } = await createPair("ACME");
    await approveFully(zhId);

    expect((await h.request("SALES", "POST", `/pi/${zhId}/revisions`, { reason: " " })).status).toBe(400);
    expect((await h.request("COMMERCE", "POST", `/pi/${zhId}/revisions`, { reason: "x" })).status).toBe(403);
    expect((await h.request("SALES", "POST", `/pi/${zhId}/revisions`, { reason: "Customer wants 5 units" })).status).toBe(200);
    expect((await h.request("SALES", "POST", `/pi/${zhId}/revisions`, { reason: "again" })).status).toBe(400);

    // The pair is editable again; edit both languages.
    expect((await h.request("SALES", "PATCH", `/pi/${zhId}`, { customerCompany: "ACME Ltd", items: [item(5)] })).status).toBe(200);
    expect((await h.request("SALES", "PATCH", `/pi/${enId}`, { customerCompany: "ACME Ltd", items: [item(5)] })).status).toBe(200);

    // After-sales and the approved list still see the approved content.
    const service = await h.request("SERVICE", "GET", `/pi/${zhId}/view`);
    expect(service.status).toBe(200);
    expect(service.body.zh.current).toBeNull();
    expect(service.body.zh.effective.pi.customerCompany).toBe("ACME");
    expect(service.body.zh.effective.items[0].quantity).toBe(2);
    expect(service.body.en).toBeNull();

    const list = await h.request("COMMERCE", "GET", "/pi/approved");
    expect(list.body.items.map((p: any) => [p.id, p.customerCompany, p.revisionInProgress])).toEqual([[zhId, "ACME", 1]]);

    // Effective export reads the frozen snapshot, for both languages.
    const zhExport = await h.request("ADMIN", "GET", `/pi/${zhId}/export-bundle?version=effective`);
    expect(zhExport.body.pi.customerCompany).toBe("ACME");
    expect(zhExport.body.items[0].quantity).toBe(2);
    const enExport = await h.request("ADMIN", "GET", `/pi/${enId}/export-bundle?version=effective`);
    expect(enExport.body.pi.customerCompany).toBe("ACME");

    // The revision draft is not garbage-collected, and cannot be deleted.
    expect((await h.request("SALES", "DELETE", `/pi/${zhId}`)).status).toBe(400);
    await purgeExpired(h.db, new Date(Date.now() + 10 * 24 * 60 * 60 * 1000));
    expect(await status(zhId)).toBe("DRAFT");

    // Through both steps again; the reviewer sees current vs effective to highlight changes.
    await h.request("SALES", "POST", `/pi/${zhId}/submit-for-review`, {});
    await h.request("ADMIN", "POST", `/pi/${zhId}/approve`, {});
    const review = await h.request("COMMERCE", "GET", `/pi/${zhId}/view`);
    expect(review.body.zh.current.pi.customerCompany).toBe("ACME Ltd");
    expect(review.body.zh.effective.pi.customerCompany).toBe("ACME");
    expect(review.body.en.effective.pi.customerCompany).toBe("ACME");
    expect(review.body.revisionInProgress).toBe(true);

    await h.request("COMMERCE", "POST", `/pi/${zhId}/commerce-approve`, {});
    const done = await h.db.prepare("SELECT status, revisionNo, revisionInProgress, effectiveSnapshot, customerCompany FROM pi WHERE id=?").bind(zhId).first();
    expect(done).toEqual({ status: "APPROVED", revisionNo: 2, revisionInProgress: 0, effectiveSnapshot: null, customerCompany: "ACME Ltd" });

    const events = (await h.request("SALES", "GET", `/pi/${zhId}/view`)).body.events;
    expect(events.filter((e: any) => e.action === "REVISION_STARTED").map((e: any) => [e.note, e.revisionNo])).toEqual([["Customer wants 5 units", 2]]);
    expect(events.at(-1)).toMatchObject({ action: "APPROVED", step: "COMMERCE", revisionNo: 2 });
  });

  it("abandoning a revision restores both languages exactly", async () => {
    const { zhId, enId } = await createPair("ACME");
    await approveFully(zhId);
    await h.request("SALES", "POST", `/pi/${zhId}/revisions`, { reason: "try" });
    await h.request("SALES", "PATCH", `/pi/${zhId}`, { customerCompany: "Other", items: [item(9)] });
    await h.request("SALES", "PATCH", `/pi/${enId}`, { customerCompany: "Other", items: [item(9), item(1)] });

    expect((await h.request("SALES", "POST", `/pi/${zhId}/revisions/abandon`)).status).toBe(200);

    const zh = (await h.request("SALES", "GET", `/pi/${zhId}`)).body;
    expect(zh.pi.status).toBe("APPROVED");
    expect(zh.pi.customerCompany).toBe("ACME");
    expect(zh.items.map((i: any) => i.quantity)).toEqual([2]);
    expect(JSON.parse(zh.items[0].fieldValues)).toEqual(expect.any(Array));
    const en = (await h.request("SALES", "GET", `/pi/${enId}`)).body;
    expect(en.pi.customerCompany).toBe("ACME");
    expect(en.items.map((i: any) => i.quantity)).toEqual([2]);
    // Locked again.
    expect((await h.request("SALES", "PATCH", `/pi/${enId}`, { customerCompany: "X" })).status).toBe(400);
  });
});

describe("workspace and approved list", () => {
  it("the ZH workspace shows work in progress only; the approved list pages and searches", async () => {
    const a = await createPair("Alpha Charging", "PO-A");
    const b = await createPair("Beta Energy", "PO-B");
    await approveFully(a.zhId);

    const workspace = await h.request("SALES", "GET", "/pi?language=ZH");
    expect(workspace.body.map((p: any) => p.id)).toEqual([b.zhId]);

    expect((await h.request("SALES", "GET", "/pi/approved")).body.items.map((p: any) => p.id)).toEqual([a.zhId]);
    expect((await h.request("SERVICE", "GET", "/pi/approved?q=PO-A")).body.items).toHaveLength(1);
    expect((await h.request("SERVICE", "GET", "/pi/approved?q=alpha")).body.items).toHaveLength(1);
    expect((await h.request("SERVICE", "GET", "/pi/approved?q=Beta")).body.items).toHaveLength(0);
    // LIKE wildcards in the query are literal.
    expect((await h.request("SERVICE", "GET", "/pi/approved?q=%25")).body.items).toHaveLength(0);
  });

  it("sales only see their own approved PIs", async () => {
    const { zhId } = await createPair();
    await approveFully(zhId);
    const otherSales = { id: "usr_other", username: "other", displayName: "Other", role: "SALES" as const };
    await h.db.prepare("INSERT INTO users (id, username, passwordHash, displayName, role) VALUES (?, ?, 'x', ?, 'SALES')").bind(otherSales.id, otherSales.username, otherSales.displayName).run();
    expect((await h.request(otherSales, "GET", "/pi/approved")).body.items).toHaveLength(0);
    expect((await h.request("COMMERCE", "GET", "/pi/approved")).body.items).toHaveLength(1);
  });

  it("pages in 50s", async () => {
    for (let i = 0; i < 51; i++) {
      await h.db
        .prepare("INSERT INTO pi (id, language, piNo, seq, status, date, customerCompany, createdById, approvedAt) VALUES (?, 'ZH', ?, ?, 'APPROVED', '2026-01-01', 'C', 'usr_sales', ?)")
        .bind(`pi_${i}`, `ZH-${i}`, i, `2026-01-01 00:00:${String(i).padStart(2, "0")}`)
        .run();
    }
    const page1 = await h.request("COMMERCE", "GET", "/pi/approved");
    expect(page1.body.items).toHaveLength(50);
    expect(page1.body.hasMore).toBe(true);
    const page2 = await h.request("COMMERCE", "GET", "/pi/approved?offset=50");
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.hasMore).toBe(false);
  });
});

describe("retention", () => {
  it("keeps approved ZH PIs for three years after commerce approval", async () => {
    const insert = (id: string, approvedAt: string, revisionInProgress = 0) =>
      h.db
        .prepare("INSERT INTO pi (id, language, piNo, seq, status, date, customerCompany, createdById, approvedAt, revisionInProgress) VALUES (?, 'ZH', ?, 1, 'APPROVED', '2023-01-01', 'C', 'usr_sales', ?, ?)")
        .bind(id, id, approvedAt, revisionInProgress)
        .run();
    await insert("keep", "2023-10-20 00:00:00");
    await insert("drop", "2023-10-18 00:00:00");
    await h.db.prepare("INSERT INTO piItems (id, piId, productId, quantity, unitPrice, discountPct, fieldValues, sortOrder) VALUES ('it', 'drop', ?, 1, 1, 0, '[]', 0)").bind(productId).run();

    await purgeExpired(h.db, new Date("2026-10-19T00:00:00Z"));

    const left = await h.db.prepare("SELECT id FROM pi ORDER BY id").all();
    expect(left.results.map((r: any) => r.id)).toEqual(["keep"]);
    expect((await h.db.prepare("SELECT COUNT(*) AS n FROM piItems").first<{ n: number }>())?.n).toBe(0);
  });

  it("still clears idle drafts after three days", async () => {
    await h.db
      .prepare("INSERT INTO pi (id, language, piNo, seq, status, date, customerCompany, createdById, updatedAt) VALUES ('old', 'EN', 'EN-old', 1, 'DRAFT', '2026-01-01', 'C', 'usr_sales', '2026-10-15 00:00:00')")
      .run();
    await h.db
      .prepare("INSERT INTO pi (id, language, piNo, seq, status, date, customerCompany, createdById, updatedAt) VALUES ('new', 'EN', 'EN-new', 2, 'DRAFT', '2026-01-01', 'C', 'usr_sales', '2026-10-17 00:00:00')")
      .run();
    await purgeExpired(h.db, new Date("2026-10-19T00:00:00Z"));
    const left = await h.db.prepare("SELECT id FROM pi").all();
    expect(left.results.map((r: any) => r.id)).toEqual(["new"]);
  });
});
