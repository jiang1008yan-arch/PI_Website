import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness, seedProduct, type Harness } from "./harness";

// After-sales: device SNs on approved PIs, tickets matched to PIs by production
// order number or SN, confirmed product line + fault type, repeat-fault counts
// and the product × fault statistics.

let h: Harness;
let productId: string;
beforeEach(async () => {
  h = await createHarness();
  productId = await seedProduct(h.db);
  await h.request("ADMIN", "PUT", "/options/faultType", { values: ["Offline", "Screen fault"] });
});
afterEach(async () => {
  await h.close();
});

async function approvedZh(productionOrderNo: string, customerCompany = "ACME") {
  const res = await h.request("SALES", "POST", "/pi", {
    language: "ZH",
    customerCompany,
    productionOrderNo,
    items: [{ productId, quantity: 3, unitPrice: 100, discountPct: 0, fieldValues: [] }]
  });
  const zhId = res.body.id as string;
  await h.request("SALES", "POST", `/pi/${zhId}/submit-for-review`, {});
  await h.request("ADMIN", "POST", `/pi/${zhId}/approve`, {});
  await h.request("COMMERCE", "POST", `/pi/${zhId}/commerce-approve`, {});
  return zhId;
}

async function ticket(orderNo: string) {
  const res = await h.request("SALES", "POST", "/tickets", { customerCompany: "ACME", orderNo, contactName: "Li", contactInfo: "li@x", productId, answers: {} });
  expect(res.status).toBe(200);
  return res.body.id as string;
}

describe("device serial numbers", () => {
  it("after-sales register SNs on an approved PI; duplicates are reported, not moved", async () => {
    const a = await approvedZh("PO-A");
    const b = await approvedZh("PO-B");

    expect((await h.request("SALES", "POST", `/pi/${a}/devices`, { serials: "SN-1" })).status).toBe(403);
    const first = await h.request("SERVICE", "POST", `/pi/${a}/devices`, { serials: "sn-1\nSN-2\n??" });
    expect(first.body).toEqual({ added: ["SN-1", "SN-2"], duplicates: [], invalid: ["??"] });

    const second = await h.request("ADMIN", "POST", `/pi/${b}/devices`, { serials: "SN-2\nSN-3" });
    expect(second.body.added).toEqual(["SN-3"]);
    expect(second.body.duplicates).toEqual([{ serialNumber: "SN-2", piNo: expect.any(String), samePi: false }]);

    const list = await h.request("SERVICE", "GET", `/pi/${a}/devices`);
    expect(list.body.map((d: any) => d.serialNumber)).toEqual(["SN-1", "SN-2"]);

    // Searchable from the approved list.
    const found = await h.request("SERVICE", "GET", "/pi/approved?q=sn-3");
    expect(found.body.items.map((p: any) => p.id)).toEqual([b]);

    expect((await h.request("SERVICE", "DELETE", `/pi/${a}/devices/${list.body[0].id}`)).status).toBe(200);
    expect((await h.request("SERVICE", "GET", `/pi/${a}/devices`)).body).toHaveLength(1);
  });

  it("refuses SNs on PIs that are not approved", async () => {
    const res = await h.request("SALES", "POST", "/pi", { language: "ZH", customerCompany: "X", items: [] });
    expect((await h.request("SERVICE", "POST", `/pi/${res.body.id}/devices`, { serials: "SN-9" })).status).toBe(400);
  });
});

describe("tickets and PIs", () => {
  it("matches a ticket to its approved PI by production order number and by SN", async () => {
    const zhId = await approvedZh("PO-777");
    await h.request("SERVICE", "POST", `/pi/${zhId}/devices`, { serials: "CHG-0001" });
    const t = await ticket(" PO-777 ");

    const detail = await h.request("SERVICE", "GET", `/tickets/${t}`);
    expect(detail.body.matchedPis.map((p: any) => p.id)).toEqual([zhId]);
    expect(detail.body.device).toBeNull();

    expect((await h.request("SALES", "PATCH", `/tickets/${t}/product`, { productId, productModel: "AC-7K-T2", serialNumber: "chg-0001" })).status).toBe(403);
    expect((await h.request("SERVICE", "PATCH", `/tickets/${t}/product`, { productId, productModel: "AC-7K-T2", serialNumber: "chg-0001" })).status).toBe(200);
    const after = await h.request("SERVICE", "GET", `/tickets/${t}`);
    expect(after.body.ticket).toMatchObject({ productModel: "AC-7K-T2", serialNumber: "CHG-0001" });
    expect(after.body.device).toMatchObject({ serialNumber: "CHG-0001", piId: zhId });
  });

  it("shows no match for an unknown production order number", async () => {
    const t = await ticket("PO-UNKNOWN");
    expect((await h.request("SERVICE", "GET", `/tickets/${t}`)).body.matchedPis).toEqual([]);
  });
});

describe("fault types and statistics", () => {
  it("only after-sales/admin confirm fault types, from the maintained list", async () => {
    const t = await ticket("PO-1");
    expect((await h.request("SALES", "PATCH", `/tickets/${t}/fault`, { faultType: "Offline" })).status).toBe(403);
    expect((await h.request("SERVICE", "PATCH", `/tickets/${t}/fault`, { faultType: "Made up" })).status).toBe(400);
    const ok = await h.request("SERVICE", "PATCH", `/tickets/${t}/fault`, { faultType: "Offline" });
    expect(ok.status).toBe(200);
    expect(ok.body.repeat).toMatchObject({ count: 1, isRepeat: false, windowDays: 90, threshold: 3 });
    const timeline = (await h.request("SALES", "GET", `/tickets/${t}`)).body.updates;
    expect(timeline.at(-1)).toMatchObject({ kind: "NOTE", note: "Fault type confirmed: Offline" });
  });

  it("after-sales maintain the fault type list; the repeat thresholds stay admin-only", async () => {
    expect((await h.request("SERVICE", "PUT", "/options/faultType", { values: ["Offline", "Screen fault", "Cable"] })).status).toBe(200);
    expect((await h.request("SALES", "PUT", "/options/faultType", { values: ["x"] })).status).toBe(403);
    expect((await h.request("SERVICE", "PUT", "/options/repeatFaultThreshold", { values: ["2"] })).status).toBe(403);
    expect((await h.request("ADMIN", "PUT", "/options/repeatFaultThreshold", { values: ["2"] })).status).toBe(200);
  });

  it("flags a repeat fault at the threshold and builds the product × fault matrix", async () => {
    const ids = [await ticket("PO-1"), await ticket("PO-2"), await ticket("PO-3"), await ticket("PO-4")];
    await h.request("SERVICE", "PATCH", `/tickets/${ids[0]}/fault`, { faultType: "Offline" });
    await h.request("SERVICE", "PATCH", `/tickets/${ids[1]}/fault`, { faultType: "Offline" });
    const third = await h.request("SERVICE", "PATCH", `/tickets/${ids[2]}/fault`, { faultType: "Offline" });
    expect(third.body.repeat).toMatchObject({ count: 3, isRepeat: true });
    await h.request("SERVICE", "PATCH", `/tickets/${ids[3]}/fault`, { faultType: "Screen fault" });
    await h.request("SERVICE", "PATCH", `/tickets/${ids[0]}/product`, { productId, productModel: "AC-7K-T2" });

    // Tickets outside the window do not count.
    await h.db.prepare("UPDATE tickets SET createdAt = '2020-01-01 00:00:00' WHERE id = ?").bind(ids[0]).run();
    expect((await h.request("SERVICE", "GET", `/tickets/${ids[1]}`)).body.repeat).toMatchObject({ count: 2, isRepeat: false });

    const stats = await h.request("SALES", "GET", "/tickets/stats");
    expect(stats.body.faultMatrix).toEqual({
      faultTypes: ["Offline", "Screen fault"],
      products: [{ productId, productName: "Charger P1", total: 4, byFault: { Offline: 3, "Screen fault": 1 } }]
    });

    const breakdown = await h.request("SALES", "GET", `/tickets/fault-breakdown?productId=${productId}&faultType=Offline`);
    expect(breakdown.body.byModel).toEqual([
      { model: "(model not recorded)", n: 2 },
      { model: "AC-7K-T2", n: 1 }
    ]);
    const drill = await h.request("SALES", "GET", `/tickets?productId=${productId}&faultType=Offline`);
    expect(drill.body).toHaveLength(3);
  });
});
