import { id } from "./db";
import type { PiRow, PiStatus } from "./piAccess";
import { piItemReplaceStatements, type PiItemInput } from "./piItems";

export type WorkflowAction = "SUBMITTED" | "APPROVED" | "REJECTED";

// PiItemInput now lives with the piItems writer that consumes it; re-exported
// so existing importers of it from this module keep working.
export type { PiItemInput };

export type SubmittedSnapshot = {
  header: Record<string, unknown>;
  items: unknown[];
};

export type PiUpdate = {
  status?: PiStatus;
  rejectionNote?: string | null;
  assignedToId?: string | null;
  submittedSnapshot?: string | null;
};

export type TransitionPlan = {
  piUpdate?: PiUpdate;
  headerOverride?: Record<string, unknown>;
  itemsReplace?: PiItemInput[];
  event?: { action: WorkflowAction; note?: string | null };
  delete?: true;
};

// Columns the workflow is the sole writer of.
const WORKFLOW_COLUMNS = ["status", "rejectionNote", "assignedToId", "submittedSnapshot"] as const;

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
    event: { action: "SUBMITTED" }
  };
}

export function planApprove(
  _row: PiRow,
  payload: { pi?: Record<string, unknown>; items?: PiItemInput[] } = {}
): TransitionPlan {
  const headerOverride = payload.pi ? sanitizeHeaderOverride(payload.pi) : undefined;
  return {
    piUpdate: { status: "APPROVED" },
    ...(headerOverride && Object.keys(headerOverride).length ? { headerOverride } : {}),
    ...(payload.items !== undefined ? { itemsReplace: payload.items } : {}),
    event: { action: "APPROVED" }
  };
}

export function planReject(_row: PiRow, payload: { note?: string } = {}): TransitionPlan {
  const note = String(payload.note ?? "").trim();
  return {
    piUpdate: { status: "REJECTED", rejectionNote: note },
    event: { action: "REJECTED", note: note || null }
  };
}

export function planDelete(_row: PiRow): TransitionPlan {
  return { delete: true };
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

  if (plan.event) {
    stmts.push(
      db.prepare(
        "INSERT INTO piReviewEvents (id, piId, actorId, action, note) VALUES (?, ?, ?, ?, ?)"
      ).bind(id("evt"), piId, actorId, plan.event.action, plan.event.note ?? null)
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
