import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setFeishuFetch } from "../lib/feishu/client";
import { findKnownReferences, lookup, matchOptions, resolveMatch } from "../lib/lookup";
import { createHarness, seedProduct, type Harness } from "./harness";

// Type-ahead over existing production orders, customers and SNs, in the portal
// and in the Feishu ticket form.

let h: Harness;
let productId: string;

async function approvedPi(piNo: string, customerCompany: string, productionOrderNo: string, extra: Record<string, unknown> = {}) {
  const id = `pi_${piNo}`;
  await h.db
    .prepare(
      `INSERT INTO pi (id, piNo, seq, date, language, status, customerCompany, productionOrderNo, createdById, approvedAt, revisionInProgress, effectiveSnapshot)
       VALUES (?, ?, 1, '2026-10-01', 'ZH', ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`
    )
    .bind(id, piNo, extra.status ?? "APPROVED", customerCompany, productionOrderNo, h.users.SALES.id, extra.revisionInProgress ?? 0, extra.effectiveSnapshot ?? null)
    .run();
  return id;
}

beforeEach(async () => {
  h = await createHarness();
  productId = await seedProduct(h.db);
  const pi1 = await approvedPi("ZH-001", "Iberia Charge SL", "PO-2026-0901");
  await approvedPi("ZH-002", "Nordic EV AB", "PO-2026-0902");
  // Under revision: the live row says something else; the effective version wins.
  await approvedPi("ZH-003", "Draft Name", "PO-DRAFT", {
    status: "DRAFT",
    revisionInProgress: 1,
    effectiveSnapshot: JSON.stringify({ zh: { header: { customerCompany: "Alpine Power AG", productionOrderNo: "PO-2026-0950" }, items: [] } })
  });
  await approvedPi("ZH-004", "Not Approved Ltd", "PO-2026-0999", { status: "PENDING_REVIEW" });
  await h.db.prepare("INSERT INTO devices (id, serialNumber, piId, createdById) VALUES ('dev1', 'CHG-0901-0001', ?, ?)").bind(pi1, h.users.SERVICE.id).run();
  await h.request("SERVICE", "POST", "/tickets", { customerCompany: "iberia charge sl", contactName: "Li", contactInfo: "x", productId, answers: {} });
});
afterEach(async () => {
  setFeishuFetch(null);
  await h.close();
});

describe("lookup", () => {
  it("finds production orders by number, PI number or customer — approved and effective only", async () => {
    const r = await lookup(h.db, "09", "order");
    expect(r.orders.map((o) => o.productionOrderNo).sort()).toEqual(["PO-2026-0901", "PO-2026-0902", "PO-2026-0950"]);
    expect((await lookup(h.db, "alpine", "order")).orders[0]).toMatchObject({ productionOrderNo: "PO-2026-0950", customerCompany: "Alpine Power AG", piNo: "ZH-003" });
    expect((await lookup(h.db, "draft", "order")).orders).toEqual([]);
    expect((await lookup(h.db, "0999", "order")).orders).toEqual([]);
    // An exact number comes first.
    expect((await lookup(h.db, "po-2026-0902", "order")).orders[0].productionOrderNo).toBe("PO-2026-0902");
  });

  it("merges customer names from PIs and tickets regardless of case", async () => {
    const r = await lookup(h.db, "iber", "customer");
    expect(r.customers).toHaveLength(1);
    expect(r.customers[0]).toMatchObject({ piCount: 1, ticketCount: 1 });
  });

  it("finds SNs with their PI, order and customer, and ignores too-short or wildcard queries", async () => {
    expect((await lookup(h.db, "0001", "sn")).devices[0]).toMatchObject({ serialNumber: "CHG-0901-0001", productionOrderNo: "PO-2026-0901", customerCompany: "Iberia Charge SL" });
    expect(await lookup(h.db, "9", "all")).toEqual({ orders: [], customers: [], devices: [] });
    expect((await lookup(h.db, "%%", "all")).orders).toEqual([]);
  });

  it("is served to the people who create and edit tickets only", async () => {
    const res = await h.request("SERVICE", "GET", "/lookup?q=0901");
    expect(res.status).toBe(200);
    expect(res.body.orders[0].productionOrderNo).toBe("PO-2026-0901");
    expect(res.body.devices[0].serialNumber).toBe("CHG-0901-0001");
    expect((await h.request("COMMERCE", "GET", "/lookup?q=0901")).status).toBe(403);
    expect((await h.request("SALES", "GET", "/lookup?q=0901")).status).toBe(403);
  });

  it("turns results into picker options and resolves a pick", async () => {
    const options = matchOptions(await lookup(h.db, "0901"));
    expect(options[0]).toEqual({ value: "s:CHG-0901-0001", label: "SN CHG-0901-0001 · PO-2026-0901 · Iberia Charge SL" });
    expect(await resolveMatch(h.db, "s:CHG-0901-0001")).toEqual({ serialNumber: "CHG-0901-0001", orderNo: "PO-2026-0901", customerCompany: "Iberia Charge SL" });
    expect(await resolveMatch(h.db, "o:pi_ZH-003")).toEqual({ orderNo: "PO-2026-0950", customerCompany: "Alpine Power AG" });
    expect(await resolveMatch(h.db, "c:Nordic EV AB")).toEqual({ customerCompany: "Nordic EV AB" });
    expect(await resolveMatch(h.db, "o:pi_ZH-004")).toBeNull();
  });

  it("spots known orders and SNs written in a message", async () => {
    expect(await findKnownReferences(h.db, "客户说 po-2026-0902 的桩一直离线")).toMatchObject({ order: { productionOrderNo: "PO-2026-0902" }, device: null });
    expect((await findKnownReferences(h.db, "SN: CHG-0901-0001.")).device?.serialNumber).toBe("CHG-0901-0001");
    expect(await findKnownReferences(h.db, "你好")).toEqual({ order: null, device: null });
  });
});

describe("tickets use the picked values", () => {
  it("a new ticket keeps its model and SN; after-sales can correct customer and order with a log", async () => {
    const created = await h.request("SERVICE", "POST", "/tickets", {
      customerCompany: "Iberia Charge SL",
      orderNo: "PO-2026-0901",
      contactName: "Ana",
      contactInfo: "a@x",
      productId,
      productModel: "AC7-T2-EU",
      serialNumber: " chg-0901-0001 ",
      assignedSalesId: h.users.SALES.id,
      answers: {}
    });
    const id = created.body.id;
    expect((await h.request("SERVICE", "GET", `/tickets/${id}`)).body).toMatchObject({
      ticket: { productModel: "AC7-T2-EU", serialNumber: "CHG-0901-0001" },
      device: { serialNumber: "CHG-0901-0001" }
    });
    expect((await h.request("SALES", "PATCH", `/tickets/${id}/customer`, { orderNo: "PO-2026-0902" })).status).toBe(403);
    // SNs come from other systems: an SN the system does not know is refused.
    expect((await h.request("SERVICE", "PATCH", `/tickets/${id}/product`, { serialNumber: "TYPED-BY-HAND" })).body.error).toBe("That SN is not known to the system.");
    const typed = await h.request("SERVICE", "POST", "/tickets", { contactName: "A", contactInfo: "a", productId, serialNumber: "TYPED-BY-HAND", answers: {} });
    expect(typed.status).toBe(400);
    // One reported by the charger backend is known, even if not registered on a PI.
    await h.db.prepare("INSERT INTO deviceStatus (serialNumber, status, lastEventAt) VALUES ('BACKEND-ONLY-1', 'ONLINE', '2026-10-20 00:00:00')").run();
    expect((await h.request("SERVICE", "PATCH", `/tickets/${id}/product`, { serialNumber: "BACKEND-ONLY-1" })).status).toBe(200);
    // Leaving fields out keeps them; the PI's own SNs are listed for picking.
    expect((await h.request("SERVICE", "GET", `/tickets/${id}`)).body.ticket).toMatchObject({ serialNumber: "BACKEND-ONLY-1", productModel: "AC7-T2-EU" });
    expect((await h.request("SERVICE", "GET", "/lookup/pi/pi_ZH-001/devices")).body).toEqual(["CHG-0901-0001"]);
    expect((await h.request("SERVICE", "GET", "/lookup/pi/pi_ZH-004/devices")).body).toEqual([]);
    await h.request("SERVICE", "PATCH", `/tickets/${id}/customer`, { customerCompany: "Nordic EV AB", orderNo: "PO-2026-0902" });
    const detail = (await h.request("SERVICE", "GET", `/tickets/${id}`)).body;
    expect(detail.ticket).toMatchObject({ customerCompany: "Nordic EV AB", orderNo: "PO-2026-0902" });
    expect(detail.matchedPis[0].piNo).toBe("ZH-002");
    const notes = detail.updates.map((u: any) => u.note);
    expect(notes).toContain("Customer: Iberia Charge SL → Nordic EV AB");
    expect(notes).toContain("Production order no.: PO-2026-0901 → PO-2026-0902");
  });
});
