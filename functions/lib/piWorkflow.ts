import { id } from "./db";
import type { PiRow, PiStatus } from "./piAccess";
import { piItemReplaceStatements, type PiItemInput } from "./piItems";

export type WorkflowAction = "SUBMITTED" | "APPROVED" | "REJECTED" | "REVISION_STARTED" | "REVISION_ABANDONED";
export type ApprovalStep = "PRESALES" | "COMMERCE";

// PiItemInput now lives with the piItems writer that consumes it; re-exported
// so existing importers of it from this module keep working.
export type { PiItemInput };

export type SubmittedSnapshot = {
  header: Record<string, unknown>;
  items: unknown[];
};

// The approved content of a ZH PI and its linked EN PI, frozen while a revision
// is in progress (see docs/adr/0001-revision-via-effective-snapshot.md).
export type EffectiveSnapshot = {
  zh: { header: Record<string, unknown>; items: PiItemInput[] };
  en: { piId: string; header: Record<string, unknown>; items: PiItemInput[] } | null;
};

export type PiUpdate = {
  status?: PiStatus;
  rejectionNote?: string | null;
  assignedToId?: string | null;
  submittedSnapshot?: string | null;
  approvedAt?: string | null;
  revisionNo?: number;
  revisionInProgress?: number;
  revisionReason?: string | null;
  effectiveSnapshot?: string | null;
};

export type TransitionEvent = {
  action: WorkflowAction;
  note?: string | null;
  step?: ApprovalStep;
  revisionNo?: number;
};

export type TransitionPlan = {
  piUpdate?: PiUpdate;
  headerOverride?: Record<string, unknown>;
  itemsReplace?: PiItemInput[];
  // Header/item writes to another PI in the same atomic batch — used to
  // restore the linked EN PI when a revision is abandoned.
  linkedWrites?: { piId: string; headerOverride?: Record<string, unknown>; itemsReplace?: PiItemInput[] }[];
  event?: TransitionEvent;
  delete?: true;
};

// Columns the workflow is the sole writer of.
const WORKFLOW_COLUMNS = [
  "status", "rejectionNote", "assignedToId", "submittedSnapshot",
  "approvedAt", "revisionNo", "revisionInProgress", "revisionReason", "effectiveSnapshot"
] as const;

// Header columns a route handler is allowed to update (via PATCH for headers,
// or via approve-with-edits when the reviewer commits changes). Everything
// outside this list is either workflow-owned (see WORKFLOW_COLUMNS), bookkeeping
// (createdAt/updatedAt/seq), or identity (id, piNo is a separate concern).
const EDITABLE_HEADER_COLUMNS = [
  "piNo", "date",
  "customerCompany", "customerContact", "customerEmail", "customerPhone",
  "customerCountry", "customerAddress",
  "validUntil", "incoterm", "shipmentMode", "paymentTerm",
  "productionOrderNo", "customerSource", "customerType", "deliveryDate",
  "senderCorp", "senderAddress", "senderFrom", "senderPhone", "senderEmail",
  "otherRequirements"
] as const;

export const EDITABLE_HEADER_COLUMN_SET: ReadonlySet<string> = new Set(EDITABLE_HEADER_COLUMNS);

type WidePiRow = PiRow & Record<string, unknown>;

// The revision number the next review event belongs to: while a revision is in
// progress the PI is working towards revisionNo + 1.
function workingRevision(row: WidePiRow): number {
  const current = Number(row.revisionNo ?? 1) || 1;
  return row.revisionInProgress ? current + 1 : current;
}

// ── Pure planners ──────────────────────────────────────────────────────────

export function planSubmit(_row: PiRow): TransitionPlan {
  return { piUpdate: { status: "SUBMITTED" } };
}

export function planSubmitForReview(
  row: WidePiRow,
  items: unknown[],
  payload: { assignedToId?: string | null } = {}
): TransitionPlan {
  const snapshot: SubmittedSnapshot = {
    header: snapshotHeader(row),
    items
  };
  return {
    piUpdate: {
      status: "PENDING_REVIEW",
      rejectionNote: null,
      assignedToId: payload.assignedToId ?? null,
      submittedSnapshot: JSON.stringify(snapshot)
    },
    event: { action: "SUBMITTED", revisionNo: workingRevision(row) }
  };
}

// Presales confirmation: the ADMIN recipient confirms (optionally committing
// edits made in review mode) and the PI moves on to commerce approval.
export function planApprove(
  row: WidePiRow,
  payload: { pi?: Record<string, unknown>; items?: PiItemInput[] } = {}
): TransitionPlan {
  const headerOverride = payload.pi ? sanitizeHeaderOverride(payload.pi) : undefined;
  return {
    piUpdate: { status: "PENDING_COMMERCE" },
    ...(headerOverride && Object.keys(headerOverride).length ? { headerOverride } : {}),
    ...(payload.items !== undefined ? { itemsReplace: payload.items } : {}),
    event: { action: "APPROVED", step: "PRESALES", revisionNo: workingRevision(row) }
  };
}

// Presales rejection.
export function planReject(row: WidePiRow, payload: { note?: string } = {}): TransitionPlan {
  const note = String(payload.note ?? "").trim();
  return {
    piUpdate: { status: "REJECTED", rejectionNote: note },
    event: { action: "REJECTED", note: note || null, step: "PRESALES", revisionNo: workingRevision(row) }
  };
}

// Commerce approval: the final step. Completing a revision makes the revised
// content the new effective version.
export function planCommerceApprove(row: WidePiRow, now: Date): TransitionPlan {
  const revisionNo = workingRevision(row);
  const piUpdate: PiUpdate = { status: "APPROVED", approvedAt: sqlTimestamp(now), rejectionNote: null };
  if (row.revisionInProgress) {
    Object.assign(piUpdate, { revisionNo, revisionInProgress: 0, revisionReason: null, effectiveSnapshot: null });
  }
  return { piUpdate, event: { action: "APPROVED", step: "COMMERCE", revisionNo } };
}

export function planCommerceReject(row: WidePiRow, payload: { note?: string } = {}): TransitionPlan {
  const note = String(payload.note ?? "").trim();
  return {
    piUpdate: { status: "REJECTED", rejectionNote: note },
    event: { action: "REJECTED", note: note || null, step: "COMMERCE", revisionNo: workingRevision(row) }
  };
}

// Start a revision of an approved ZH PI: freeze the approved ZH + linked EN
// content as the effective version and reopen the live row as a DRAFT.
export function planStartRevision(
  row: WidePiRow,
  zhItems: Record<string, unknown>[],
  en: { row: WidePiRow; items: Record<string, unknown>[] } | null,
  reason: string
): TransitionPlan {
  const snapshot: EffectiveSnapshot = {
    zh: { header: snapshotHeader(row), items: zhItems.map(toItemInput) },
    en: en ? { piId: en.row.id, header: snapshotHeader(en.row), items: en.items.map(toItemInput) } : null
  };
  const nextRevision = (Number(row.revisionNo ?? 1) || 1) + 1;
  return {
    piUpdate: {
      status: "DRAFT",
      rejectionNote: null,
      revisionInProgress: 1,
      revisionReason: reason,
      effectiveSnapshot: JSON.stringify(snapshot)
    },
    event: { action: "REVISION_STARTED", note: reason, revisionNo: nextRevision }
  };
}

// Abandon a revision: put the frozen effective version back on the live rows.
export function planAbandonRevision(row: WidePiRow): TransitionPlan {
  const snapshot = parseEffectiveSnapshot(row.effectiveSnapshot);
  if (!snapshot) throw new Error("Revision has no effective snapshot to restore");
  return {
    piUpdate: {
      status: "APPROVED",
      rejectionNote: null,
      revisionInProgress: 0,
      revisionReason: null,
      effectiveSnapshot: null
    },
    headerOverride: sanitizeHeaderOverride(snapshot.zh.header),
    itemsReplace: snapshot.zh.items,
    ...(snapshot.en
      ? { linkedWrites: [{ piId: snapshot.en.piId, headerOverride: sanitizeHeaderOverride(snapshot.en.header), itemsReplace: snapshot.en.items }] }
      : {}),
    event: { action: "REVISION_ABANDONED", revisionNo: workingRevision(row) }
  };
}

export function planDelete(_row: PiRow): TransitionPlan {
  return { delete: true };
}

export function parseEffectiveSnapshot(raw: unknown): EffectiveSnapshot | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && parsed.zh ? (parsed as EffectiveSnapshot) : null;
  } catch {
    return null;
  }
}

function toItemInput(item: Record<string, unknown>): PiItemInput {
  const raw = item.fieldValues;
  let fieldValues: unknown[] = [];
  if (Array.isArray(raw)) fieldValues = raw;
  else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) fieldValues = parsed;
    } catch {
      // keep empty
    }
  }
  return {
    productId: String(item.productId),
    quantity: Number(item.quantity ?? 1),
    unitPrice: Number(item.unitPrice ?? 0),
    discountPct: Number(item.discountPct ?? 0),
    fieldValues
  };
}

function sqlTimestamp(now: Date): string {
  return now.toISOString().slice(0, 19).replace("T", " ");
}

function sanitizeHeaderOverride(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of EDITABLE_HEADER_COLUMNS) {
    if (col in input) out[col] = input[col];
  }
  return out;
}

function snapshotHeader(row: WidePiRow): Record<string, unknown> {
  const out: Record<string, unknown> = { language: row.language };
  for (const col of EDITABLE_HEADER_COLUMNS) {
    if (col in row) out[col] = row[col] ?? "";
  }
  return out;
}

// ── Impure runner ──────────────────────────────────────────────────────────

export async function runTransition(
  db: D1Database,
  piId: string,
  plan: TransitionPlan,
  actorId: string
): Promise<void> {
  if (plan.delete) {
    await db.batch([
      db.prepare(
        `UPDATE pi
         SET linkedPiNoSnapshot = COALESCE(
           (SELECT linked.piNo FROM pi AS linked WHERE linked.id = ?),
           NULLIF(linkedPiNoSnapshot, '')
         ),
         linkedPiId = NULL,
         updatedAt = CURRENT_TIMESTAMP
         WHERE linkedPiId = ?`
      ).bind(piId, piId),
      db.prepare("DELETE FROM piItems WHERE piId=?").bind(piId),
      db.prepare("DELETE FROM piReviewEvents WHERE piId=?").bind(piId),
      db.prepare("DELETE FROM pi WHERE id=?").bind(piId)
    ]);
    return;
  }

  const stmts: D1PreparedStatement[] = [];

  const updateStmt = buildPiUpdate(db, plan.piUpdate, plan.headerOverride, piId);
  if (updateStmt) stmts.push(updateStmt);

  if (plan.itemsReplace !== undefined) {
    stmts.push(...piItemReplaceStatements(db, piId, plan.itemsReplace));
  }

  for (const linked of plan.linkedWrites ?? []) {
    const linkedUpdate = buildPiUpdate(db, undefined, linked.headerOverride, linked.piId);
    if (linkedUpdate) stmts.push(linkedUpdate);
    if (linked.itemsReplace !== undefined) stmts.push(...piItemReplaceStatements(db, linked.piId, linked.itemsReplace));
  }

  if (plan.event) {
    stmts.push(
      db.prepare(
        "INSERT INTO piReviewEvents (id, piId, actorId, action, step, revisionNo, note) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        id("evt"),
        piId,
        actorId,
        plan.event.action,
        plan.event.step ?? null,
        plan.event.revisionNo ?? 1,
        plan.event.note ?? null
      )
    );
  }

  if (stmts.length) await db.batch(stmts);
}

function buildPiUpdate(
  db: D1Database,
  workflow: PiUpdate | undefined,
  headerOverride: Record<string, unknown> | undefined,
  piId: string
): D1PreparedStatement | null {
  const sets: string[] = [];
  const binds: unknown[] = [];

  if (workflow) {
    for (const col of WORKFLOW_COLUMNS) {
      if (col in workflow) {
        sets.push(`${col}=?`);
        binds.push((workflow as Record<string, unknown>)[col]);
      }
    }
  }
  if (headerOverride) {
    for (const col of EDITABLE_HEADER_COLUMNS) {
      if (col in headerOverride) {
        sets.push(`${col}=?`);
        binds.push(headerOverride[col] ?? "");
      }
    }
  }
  if (!sets.length) return null;
  sets.push("updatedAt=CURRENT_TIMESTAMP");
  binds.push(piId);
  return db.prepare(`UPDATE pi SET ${sets.join(", ")} WHERE id=?`).bind(...binds);
}
