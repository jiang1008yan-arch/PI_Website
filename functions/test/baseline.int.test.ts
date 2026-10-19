import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness, seedProduct, type Harness } from "./harness";

// Regression net over the existing PI and ticket flows. Each test gets a
// fresh database. Two-step approval and revisions are covered in approval.int.test.ts.

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

async function createZhPi(productId: string, extra: Record<string, unknown> = {}) {
  const res = await h.request("SALES", "POST", "/pi", {
    language: "ZH",
    customerCompany: "ACME",
    productionOrderNo: "PO-001",
    items: [{ productId, quantity: 2, unitPrice: 100, discountPct: 0, fieldValues: [] }],
    ...extra
  });
  expect(res.status).toBe(200);
  return res.body.id as string;
}

describe("ZH PI review flow", () => {
  it("submit → presales confirm → PENDING_COMMERCE with review events", async () => {
    const productId = await seedProduct(h.db);
    const piId = await createZhPi(productId);

    expect((await h.request("SALES", "POST", `/pi/${piId}/submit-for-review`, {})).status).toBe(200);
    expect((await h.request("SALES", "GET", `/pi/${piId}`)).body.pi.status).toBe("PENDING_REVIEW");

    // Pending ZH PIs are locked for direct writes.
    expect((await h.request("SALES", "PATCH", `/pi/${piId}`, { customerCompany: "X" })).status).toBe(400);

    const queue = await h.request("ADMIN", "GET", "/pi/review-queue");
    expect(queue.body.map((p: any) => p.id)).toContain(piId);

    expect((await h.request("SALES", "POST", `/pi/${piId}/approve`, {})).status).toBe(403);
    expect((await h.request("ADMIN", "POST", `/pi/${piId}/approve`, {})).status).toBe(200);

    const after = await h.request("SALES", "GET", `/pi/${piId}`);
    expect(after.body.pi.status).toBe("PENDING_COMMERCE");
    expect(after.body.events.map((e: any) => [e.action, e.step])).toEqual([["SUBMITTED", null], ["APPROVED", "PRESALES"]]);
  });

  it("reject returns the PI to the salesperson with the note", async () => {
    const productId = await seedProduct(h.db);
    const piId = await createZhPi(productId);
    await h.request("SALES", "POST", `/pi/${piId}/submit-for-review`, {});
    expect((await h.request("ADMIN", "POST", `/pi/${piId}/reject`, { note: "Wrong price" })).status).toBe(200);

    const after = await h.request("SALES", "GET", `/pi/${piId}`);
    expect(after.body.pi.status).toBe("REJECTED");
    expect(after.body.pi.rejectionNote).toBe("Wrong price");
    // Rejected PIs are editable again.
    expect((await h.request("SALES", "PATCH", `/pi/${piId}`, { customerCompany: "ACME 2" })).status).toBe(200);
  });

  it("ZH export is admin/commerce-only and requires APPROVED", async () => {
    const productId = await seedProduct(h.db);
    const piId = await createZhPi(productId);
    expect((await h.request("ADMIN", "GET", `/pi/${piId}/export-bundle`)).status).toBe(403);
    await h.request("SALES", "POST", `/pi/${piId}/submit-for-review`, {});
    await h.request("ADMIN", "POST", `/pi/${piId}/approve`, {});
    expect((await h.request("ADMIN", "GET", `/pi/${piId}/export-bundle`)).status).toBe(403);
    await h.request("COMMERCE", "POST", `/pi/${piId}/commerce-approve`, {});
    expect((await h.request("SALES", "GET", `/pi/${piId}/export-bundle`)).status).toBe(403);
    expect((await h.request("ADMIN", "GET", `/pi/${piId}/export-bundle`)).status).toBe(200);
  });

  it("SERVICE cannot read another user's PI", async () => {
    const productId = await seedProduct(h.db);
    const piId = await createZhPi(productId);
    expect((await h.request("SERVICE", "GET", `/pi/${piId}`)).status).toBe(403);
  });

  it("rejects unauthenticated requests", async () => {
    expect((await h.request(null, "GET", "/pi")).status).toBe(401);
  });
});

describe("tickets", () => {
  async function createTicket(productId: string) {
    const res = await h.request("SALES", "POST", "/tickets", {
      customerCompany: "ACME",
      orderNo: "PO-001",
      contactName: "Li",
      contactInfo: "li@example.com",
      productId,
      answers: {}
    });
    expect(res.status).toBe(200);
    return res.body.id as string;
  }

  it("service moves status along the allowed path and writes the timeline", async () => {
    const productId = await seedProduct(h.db);
    const ticketId = await createTicket(productId);

    expect((await h.request("SALES", "PATCH", `/tickets/${ticketId}/status`, { status: "IN_PROGRESS" })).status).toBe(403);
    expect((await h.request("SERVICE", "PATCH", `/tickets/${ticketId}/status`, { status: "CLOSED" })).status).toBe(400);
    expect((await h.request("SERVICE", "PATCH", `/tickets/${ticketId}/status`, { status: "IN_PROGRESS" })).status).toBe(200);
    expect((await h.request("SERVICE", "POST", `/tickets/${ticketId}/notes`, { note: "Called customer" })).status).toBe(200);

    const detail = await h.request("SALES", "GET", `/tickets/${ticketId}`);
    expect(detail.body.ticket.status).toBe("IN_PROGRESS");
    expect(detail.body.updates.map((u: any) => u.kind)).toEqual(["STATUS", "NOTE"]);
  });

  it("is closed to commerce", async () => {
    expect((await h.request("COMMERCE", "GET", "/tickets")).status).toBe(403);
    expect((await h.request("COMMERCE", "GET", "/tickets/stats")).status).toBe(403);
  });

  it("requires an active product", async () => {
    const res = await h.request("SALES", "POST", "/tickets", { contactName: "Li", contactInfo: "x", productId: "nope", answers: {} });
    expect(res.status).toBe(400);
  });
});
