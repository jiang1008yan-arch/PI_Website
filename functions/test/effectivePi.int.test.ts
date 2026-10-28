import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EFFECTIVE_ZH, effectiveHeader, readEffective } from "../lib/effectivePi";
import { createHarness, seedProduct, type Harness } from "./harness";

// The effective version of a PI at its own interface (CONTEXT.md "Effective
// version", ADR-0001): which PIs have one, their header values, and the frozen
// content while a revision is in progress.

let h: Harness;
let productId: string;
beforeEach(async () => {
  h = await createHarness();
  productId = await seedProduct(h.db);
});
afterEach(async () => {
  await h.close();
});

async function pi(piNo: string, fields: Record<string, unknown> = {}) {
  const row = { language: "ZH", status: "APPROVED", customerCompany: "ACME", productionOrderNo: "PO-1", revisionInProgress: 0, effectiveSnapshot: null, ...fields };
  await h.db
    .prepare(
      `INSERT INTO pi (id, piNo, seq, date, language, status, customerCompany, productionOrderNo, createdById, approvedAt, revisionInProgress, effectiveSnapshot)
       VALUES (?, ?, 1, '2026-10-01', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`
    )
    .bind(`pi_${piNo}`, piNo, row.language, row.status, row.customerCompany, row.productionOrderNo, h.users.SALES.id, row.revisionInProgress, row.effectiveSnapshot)
    .run();
}

const effectiveRows = async () =>
  (
    await h.db
      .prepare(
        `SELECT pi.piNo, ${effectiveHeader("customerCompany")} AS customerCompany, ${effectiveHeader("productionOrderNo")} AS productionOrderNo
         FROM pi WHERE ${EFFECTIVE_ZH()} ORDER BY pi.piNo`
      )
      .all<any>()
  ).results;

describe("which PIs have an effective version, and its header", () => {
  it("approved ZH PIs, and those being revised, read with the approved values", async () => {
    await pi("ZH-1", { customerCompany: "  Iberia Charge SL ", productionOrderNo: " PO-0901" });
    await pi("ZH-2", {
      status: "DRAFT",
      revisionInProgress: 1,
      customerCompany: "Being edited",
      productionOrderNo: "PO-NEW",
      effectiveSnapshot: JSON.stringify({ zh: { header: { customerCompany: "Alpine Power AG", productionOrderNo: "PO-0950" }, items: [] }, en: null })
    });
    await pi("ZH-3", { status: "PENDING_REVIEW" });
    await pi("ZH-4", { status: "DRAFT" });
    await pi("EN-1", { language: "EN" });
    await pi("ZH-5", { customerCompany: "   ", productionOrderNo: "" });

    expect(await effectiveRows()).toEqual([
      { piNo: "ZH-1", customerCompany: "Iberia Charge SL", productionOrderNo: "PO-0901" },
      { piNo: "ZH-2", customerCompany: "Alpine Power AG", productionOrderNo: "PO-0950" },
      { piNo: "ZH-5", customerCompany: "", productionOrderNo: "" }
    ]);
  });

  it("the approved list shows the trimmed values, like the type-ahead does", async () => {
    await pi("ZH-1", { customerCompany: "  Iberia Charge SL ", productionOrderNo: " PO-0901" });
    const list = await h.request("ADMIN", "GET", "/pi/approved");
    expect(list.body.items.map((p: any) => [p.customerCompany, p.productionOrderNo])).toEqual([["Iberia Charge SL", "PO-0901"]]);
  });

  it("works under another table alias", async () => {
    await pi("ZH-1");
    const row = await h.db
      .prepare(`SELECT zh.piNo, ${effectiveHeader("productionOrderNo", "zh")} AS po FROM pi zh WHERE ${EFFECTIVE_ZH("zh")}`)
      .first<any>();
    expect(row).toEqual({ piNo: "ZH-1", po: "PO-1" });
  });
});

describe("readEffective", () => {
  const item = (quantity: number) => ({ productId, quantity, unitPrice: 100, discountPct: 0, fieldValues: [] });
  const row = (id: string) => h.db.prepare("SELECT * FROM pi WHERE id=?").bind(id).first<any>();

  async function approvedPair() {
    const en = await h.request("SALES", "POST", "/pi", { language: "EN", customerCompany: "ACME", items: [item(2)] });
    const zhId = (await h.request("SALES", "POST", `/pi/${en.body.id}/resync-zh`)).body.linkedZhId as string;
    await h.request("SALES", "PATCH", `/pi/${zhId}`, { customerCompany: "ACME", productionOrderNo: "PO-1", items: [item(2)] });
    await h.request("SALES", "POST", `/pi/${zhId}/submit-for-review`, {});
    await h.request("ADMIN", "POST", `/pi/${zhId}/approve`, {});
    await h.request("COMMERCE", "POST", `/pi/${zhId}/commerce-approve`, {});
    return { zhId, enId: en.body.id as string };
  }

  it("is null when no revision is in progress: the live rows are the effective version", async () => {
    const { zhId, enId } = await approvedPair();
    expect(await readEffective(h.db, (await row(zhId))!)).toBeNull();
    expect(await readEffective(h.db, (await row(enId))!)).toBeNull();
  });

  it("gives the frozen ZH and linked EN content while a revision is in progress", async () => {
    const { zhId, enId } = await approvedPair();
    await h.request("SALES", "POST", `/pi/${zhId}/revisions`, { reason: "Customer wants 5 units" });
    await h.request("SALES", "PATCH", `/pi/${zhId}`, { customerCompany: "ACME Ltd", items: [item(5)] });
    await h.request("SALES", "PATCH", `/pi/${enId}`, { customerCompany: "ACME Ltd", items: [item(5)] });

    const zh = await readEffective(h.db, (await row(zhId))!);
    expect(zh!.pi).toMatchObject({ id: zhId, customerCompany: "ACME", productionOrderNo: "PO-1" });
    expect(zh!.items).toMatchObject([{ productId, quantity: 2, sortOrder: 0, code: "P1" }]);
    expect(JSON.parse(zh!.items[0].fieldValues)).toEqual(expect.any(Array));

    const en = await readEffective(h.db, (await row(enId))!);
    expect(en!.pi).toMatchObject({ id: enId, customerCompany: "ACME" });
    expect(en!.items).toMatchObject([{ quantity: 2 }]);
  });
});
