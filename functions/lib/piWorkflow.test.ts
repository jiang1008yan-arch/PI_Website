import { describe, expect, it } from "vitest";
import {
  parseEffectiveSnapshot,
  planAbandonRevision,
  planApprove,
  planCommerceApprove,
  planCommerceReject,
  planDelete,
  planReject,
  planStartRevision,
  planSubmit,
  planSubmitForReview,
  runTransition,
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
    expect(plan.event).toEqual({ action: "SUBMITTED", revisionNo: 1 });
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
  it("presales confirmation moves the PI on to commerce approval, no edits → minimal plan", () => {
    const plan = planApprove(row({ status: "PENDING_REVIEW" }));
    expect(plan.piUpdate).toEqual({ status: "PENDING_COMMERCE" });
    expect(plan.headerOverride).toBeUndefined();
    expect(plan.itemsReplace).toBeUndefined();
    expect(plan.event).toEqual({ action: "APPROVED", step: "PRESALES", revisionNo: 1 });
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
    expect(plan.piUpdate).toEqual({ status: "PENDING_COMMERCE" });
  });

  it("approve with itemsReplace passes items through", () => {
    const items = [{ productId: "p1", quantity: 3, unitPrice: 5, discountPct: 0, fieldValues: [] }];
    const plan = planApprove(row({ status: "PENDING_REVIEW" }), { items });
    expect(plan.itemsReplace).toEqual(items);
  });

  it("approve always records APPROVED event (APPROVED_WITH_EDITS is gone — derived from snapshot diff)", () => {
    const planWithEdits = planApprove(row(), { pi: { customerCompany: "X" } });
    const planNoEdits = planApprove(row());
    expect(planWithEdits.event).toEqual({ action: "APPROVED", step: "PRESALES", revisionNo: 1 });
    expect(planNoEdits.event).toEqual({ action: "APPROVED", step: "PRESALES", revisionNo: 1 });
  });
});

describe("planReject", () => {
  it("sets REJECTED status and rejectionNote, records REJECTED event with note", () => {
    const plan = planReject(row({ status: "PENDING_REVIEW" }), { note: "fix discount" });
    expect(plan.piUpdate?.status).toBe("REJECTED");
    expect(plan.piUpdate?.rejectionNote).toBe("fix discount");
    expect(plan.event).toEqual({ action: "REJECTED", note: "fix discount", step: "PRESALES", revisionNo: 1 });
  });

  it("trims and stores empty note as empty string on the row, null on the event", () => {
    const plan = planReject(row({ status: "PENDING_REVIEW" }), { note: "   " });
    expect(plan.piUpdate?.rejectionNote).toBe("");
    expect(plan.event).toEqual({ action: "REJECTED", note: null, step: "PRESALES", revisionNo: 1 });
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

  it("unlinks linked PIs while preserving the deleted PI number snapshot", async () => {
    const stmts: Array<{ sql: string; binds: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...binds: unknown[]) {
            return { sql, binds };
          }
        };
      },
      async batch(batchStmts: Array<{ sql: string; binds: unknown[] }>) {
        stmts.push(...batchStmts);
      }
    } as unknown as D1Database;

    await runTransition(db, "pi-en-1", planDelete(row({ id: "pi-en-1" })), "user-1");

    expect(stmts[0].sql).toContain("linkedPiNoSnapshot");
    expect(stmts[0].sql).toContain("linkedPiId = NULL");
    expect(stmts[0].binds).toEqual(["pi-en-1", "pi-en-1"]);
  });
});

describe("commerce approval", () => {
  const now = new Date("2026-10-19T08:30:00Z");

  it("approves a first version: APPROVED, approvedAt stamped, COMMERCE step event", () => {
    const plan = planCommerceApprove(row({ status: "PENDING_COMMERCE" }), now);
    expect(plan.piUpdate).toEqual({ status: "APPROVED", approvedAt: "2026-10-19 08:30:00", rejectionNote: null });
    expect(plan.event).toEqual({ action: "APPROVED", step: "COMMERCE", revisionNo: 1 });
  });

  it("completing a revision bumps the revision number and drops the frozen snapshot", () => {
    const plan = planCommerceApprove(
      row({ status: "PENDING_COMMERCE", revisionNo: 2, revisionInProgress: 1, effectiveSnapshot: "{}", revisionReason: "price" }),
      now
    );
    expect(plan.piUpdate).toMatchObject({ status: "APPROVED", revisionNo: 3, revisionInProgress: 0, effectiveSnapshot: null, revisionReason: null });
    expect(plan.event).toEqual({ action: "APPROVED", step: "COMMERCE", revisionNo: 3 });
  });

  it("commerce rejection returns the PI to the salesperson with the note", () => {
    const plan = planCommerceReject(row({ status: "PENDING_COMMERCE" }), { note: " wrong terms " });
    expect(plan.piUpdate).toEqual({ status: "REJECTED", rejectionNote: "wrong terms" });
    expect(plan.event).toEqual({ action: "REJECTED", note: "wrong terms", step: "COMMERCE", revisionNo: 1 });
  });
});

describe("revisions", () => {
  const zh = row({ status: "APPROVED", revisionNo: 1, customerCompany: "Acme" });
  const zhItems = [{ id: "i1", productId: "p1", quantity: 2, unitPrice: 10, discountPct: 0, fieldValues: '[{"label":"A","value":"1"}]' }];
  const en = { row: row({ id: "pi-en", language: "EN", piNo: "EN-1", customerCompany: "Acme EN" }), items: [{ productId: "p1", quantity: 2, unitPrice: 10, discountPct: 0, fieldValues: [] }] };

  it("starting a revision freezes ZH + EN as the effective version and reopens a DRAFT", () => {
    const plan = planStartRevision(zh, zhItems, en, "Customer changed quantity");
    expect(plan.piUpdate).toMatchObject({ status: "DRAFT", revisionInProgress: 1, revisionReason: "Customer changed quantity", rejectionNote: null });
    expect(plan.event).toEqual({ action: "REVISION_STARTED", note: "Customer changed quantity", revisionNo: 2 });
    const snapshot = parseEffectiveSnapshot(plan.piUpdate?.effectiveSnapshot);
    expect(snapshot?.zh.header.customerCompany).toBe("Acme");
    // fieldValues stored on the row as JSON text are frozen as arrays, so a restore never double-encodes.
    expect(snapshot?.zh.items[0].fieldValues).toEqual([{ label: "A", value: "1" }]);
    expect(snapshot?.en?.piId).toBe("pi-en");
    expect(snapshot?.en?.header.customerCompany).toBe("Acme EN");
  });

  it("review events during a revision count towards the next revision number", () => {
    const revising = row({ status: "PENDING_REVIEW", revisionNo: 1, revisionInProgress: 1 });
    expect(planApprove(revising).event?.revisionNo).toBe(2);
    expect(planReject(revising, { note: "x" }).event?.revisionNo).toBe(2);
  });

  it("abandoning restores the frozen ZH and EN content and goes back to APPROVED", () => {
    const started = planStartRevision(zh, zhItems, en, "r");
    const revising = row({ status: "DRAFT", revisionNo: 1, revisionInProgress: 1, effectiveSnapshot: started.piUpdate?.effectiveSnapshot, customerCompany: "Changed" });
    const plan = planAbandonRevision(revising);
    expect(plan.piUpdate).toEqual({ status: "APPROVED", rejectionNote: null, revisionInProgress: 0, revisionReason: null, effectiveSnapshot: null });
    expect(plan.headerOverride?.customerCompany).toBe("Acme");
    expect(plan.headerOverride).not.toHaveProperty("language");
    expect(plan.itemsReplace).toHaveLength(1);
    expect(plan.linkedWrites?.[0].piId).toBe("pi-en");
    expect(plan.linkedWrites?.[0].headerOverride?.customerCompany).toBe("Acme EN");
    expect(plan.event).toEqual({ action: "REVISION_ABANDONED", revisionNo: 2 });
  });

  it("refuses to abandon without a snapshot", () => {
    expect(() => planAbandonRevision(row({ status: "DRAFT", revisionInProgress: 1 }))).toThrow();
  });
});
