import { describe, expect, it } from "vitest";
import {
  planApprove,
  planDelete,
  planReject,
  planSubmit,
  planSubmitForReview,
  type SubmittedSnapshot
} from "./piWorkflow";
import type { PiRow } from "./piAccess";

const row = (overrides: Partial<PiRow & Record<string, unknown>> = {}) =>
  ({
    id: "pi-1",
    language: "ZH",
    status: "DRAFT",
    createdById: "user-1",
    piNo: "ZH-001",
    date: "2026-05-17",
    customerCompany: "Acme",
    productionOrderNo: "PO-1",
    ...overrides
  } as PiRow & Record<string, unknown>);

describe("planSubmit (EN flow)", () => {
  it("sets status SUBMITTED and records no event (EN has no review trail)", () => {
    const plan = planSubmit(row({ language: "EN" }));
    expect(plan.piUpdate).toEqual({ status: "SUBMITTED" });
    expect(plan.event).toBeUndefined();
    expect(plan.itemsReplace).toBeUndefined();
    expect(plan.headerOverride).toBeUndefined();
  });
});

describe("planSubmitForReview", () => {
  it("freezes a snapshot of the current header + items into submittedSnapshot", () => {
    const items = [{ id: "i1", productId: "p1", quantity: 2, unitPrice: 10 }];
    const plan = planSubmitForReview(row(), items, { assignedToId: "admin-9" });
    expect(plan.piUpdate?.status).toBe("PENDING_REVIEW");
    expect(plan.piUpdate?.assignedToId).toBe("admin-9");
    expect(plan.piUpdate?.rejectionNote).toBeNull();
    const snapshot = JSON.parse(plan.piUpdate?.submittedSnapshot ?? "{}") as SubmittedSnapshot;
    expect(snapshot.header.customerCompany).toBe("Acme");
    expect(snapshot.header.piNo).toBe("ZH-001");
    expect(snapshot.items).toEqual(items);
  });

  it("clears rejectionNote — a previously rejected PI starts review with no stale note", () => {
    const plan = planSubmitForReview(
      row({ status: "REJECTED", rejectionNote: "fix dates" }),
      [],
      { assignedToId: "admin-9" }
    );
    expect(plan.piUpdate?.rejectionNote).toBeNull();
  });

  it("records a SUBMITTED event", () => {
    const plan = planSubmitForReview(row(), [], {});
    expect(plan.event).toEqual({ action: "SUBMITTED" });
  });

  it("snapshot omits workflow-owned and bookkeeping columns", () => {
    const plan = planSubmitForReview(
      row({ submittedSnapshot: "old", rejectionNote: "old", assignedToId: "old", createdAt: "x", updatedAt: "y" }),
      []
    );
    const snapshot = JSON.parse(plan.piUpdate?.submittedSnapshot ?? "{}") as SubmittedSnapshot;
    expect(snapshot.header).not.toHaveProperty("submittedSnapshot");
    expect(snapshot.header).not.toHaveProperty("rejectionNote");
    expect(snapshot.header).not.toHaveProperty("assignedToId");
    expect(snapshot.header).not.toHaveProperty("createdAt");
    expect(snapshot.header).not.toHaveProperty("updatedAt");
    expect(snapshot.header).not.toHaveProperty("status");
  });
});

describe("planApprove", () => {
  it("APPROVED status, no edits → minimal plan", () => {
    const plan = planApprove(row({ status: "PENDING_REVIEW" }));
    expect(plan.piUpdate).toEqual({ status: "APPROVED" });
    expect(plan.headerOverride).toBeUndefined();
    expect(plan.itemsReplace).toBeUndefined();
    expect(plan.event).toEqual({ action: "APPROVED" });
  });

  it("approve with header edits exposes headerOverride sanitized to editable columns", () => {
    const plan = planApprove(row({ status: "PENDING_REVIEW" }), {
      pi: {
        customerCompany: "Acme Corp",
        date: "2026-05-18",
        // these should be stripped — they aren't editable header columns:
        status: "DRAFT",
        rejectionNote: "tampering",
        id: "pi-2",
        createdAt: "tampering"
      }
    });
    expect(plan.headerOverride).toEqual({ customerCompany: "Acme Corp", date: "2026-05-18" });
    expect(plan.piUpdate).toEqual({ status: "APPROVED" });
  });

  it("approve with itemsReplace passes items through", () => {
    const items = [{ productId: "p1", quantity: 3, unitPrice: 5, discountPct: 0, fieldValues: [] }];
    const plan = planApprove(row({ status: "PENDING_REVIEW" }), { items });
    expect(plan.itemsReplace).toEqual(items);
  });

  it("approve always records APPROVED event (APPROVED_WITH_EDITS is gone — derived from snapshot diff)", () => {
    const planWithEdits = planApprove(row(), { pi: { customerCompany: "X" } });
    const planNoEdits = planApprove(row());
    expect(planWithEdits.event).toEqual({ action: "APPROVED" });
    expect(planNoEdits.event).toEqual({ action: "APPROVED" });
  });
});

describe("planReject", () => {
  it("sets REJECTED status and rejectionNote, records REJECTED event with note", () => {
    const plan = planReject(row({ status: "PENDING_REVIEW" }), { note: "fix discount" });
    expect(plan.piUpdate?.status).toBe("REJECTED");
    expect(plan.piUpdate?.rejectionNote).toBe("fix discount");
    expect(plan.event).toEqual({ action: "REJECTED", note: "fix discount" });
  });

  it("trims and stores empty note as empty string on the row, null on the event", () => {
    const plan = planReject(row({ status: "PENDING_REVIEW" }), { note: "   " });
    expect(plan.piUpdate?.rejectionNote).toBe("");
    expect(plan.event).toEqual({ action: "REJECTED", note: null });
  });

  it("does not touch items or headerOverride — reject is rollback, not commit", () => {
    const plan = planReject(row({ status: "PENDING_REVIEW" }), { note: "x" });
    expect(plan.itemsReplace).toBeUndefined();
    expect(plan.headerOverride).toBeUndefined();
  });
});

describe("planDelete", () => {
  it("produces a delete-only plan", () => {
    const plan = planDelete(row());
    expect(plan.delete).toBe(true);
    expect(plan.piUpdate).toBeUndefined();
    expect(plan.event).toBeUndefined();
  });
});
