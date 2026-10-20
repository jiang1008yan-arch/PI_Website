// Single source of the PI status -> capability rules, shared across both
// bundles. Pure predicates over (role, language, status) — no DOM, no Workers,
// no env. The server ([functions/lib/piAccess.ts]) wraps these with ownership
// and Verdict/HTTP-status mapping; the client ([web/src/pi/usePiEditor.ts])
// consumes them raw for UI gating (locked / editable / deletable).
//
// Ownership is deliberately NOT here: the server enforces it in its Verdicts,
// the client relies on read-gating (you can only load a PI you may see).
//
// Types are string-literal unions, structurally identical to the Role/Language/
// PiStatus declared in each bundle, so callers pass their own typed values.

export type Role = "ADMIN" | "SALES" | "SERVICE" | "COMMERCE" | "PRESALES";
export type Language = "EN" | "ZH";
export type PiStatus = "DRAFT" | "SUBMITTED" | "PENDING_REVIEW" | "PENDING_COMMERCE" | "APPROVED" | "REJECTED";

// Facts about a PI beyond its own status that some rules need.
// - linkedZhApproved: an EN PI whose linked ZH PI has commerce approval is
//   locked together with it (until a revision of that ZH PI starts).
// - revisionInProgress: a ZH PI being revised is never deletable — its
//   approved content lives on as the effective version.
export type PiContext = { linkedZhApproved?: boolean; revisionInProgress?: boolean };

// May the PI row be written directly (PATCH / save)? EN is writable unless its
// linked ZH PI is approved. A ZH PI is directly writable only while DRAFT or
// REJECTED; PENDING_REVIEW edits go through review mode + presales
// confirmation, and PENDING_COMMERCE is never editable.
export function canEditPiDirectly(language: Language, status: PiStatus, ctx: PiContext = {}): boolean {
  if (language === "EN") return !ctx.linkedZhApproved;
  return status === "DRAFT" || status === "REJECTED";
}

// Could this role be editing a ZH PI during presales confirmation, by status
// alone? Edits are buffered client-side and committed only on confirm — never a
// direct PATCH. Whether *this* user holds the step is canActOnPresales.
export function isReviewerEditMode(role: Role, language: Language, status: PiStatus): boolean {
  return (role === "ADMIN" || role === "PRESALES") && language === "ZH" && status === "PENDING_REVIEW";
}

// Presales confirmation is done by the PRESALES user the submitter picked
// (pi.assignedToId), or by any ADMIN. This is assignment, not ownership; both
// bundles need the same answer, so it lives here.
export function canActOnPresales(role: Role, userId: string, pi: { assignedToId?: string | null }): boolean {
  if (role === "ADMIN") return true;
  return role === "PRESALES" && Boolean(pi.assignedToId) && pi.assignedToId === userId;
}

// Commerce approval is done by the COMMERCE user the submitter picked
// (pi.commerceId); PIs submitted before picks existed are open to any commerce user.
export function canActOnCommerce(role: Role, userId: string, pi: { commerceId?: string | null }): boolean {
  return role === "COMMERCE" && (!pi.commerceId || pi.commerceId === userId);
}

// Is this a commerce user looking at a ZH PI that awaits their decision?
// Commerce may approve or reject but never edit.
export function isCommerceDecisionMode(role: Role, language: Language, status: PiStatus): boolean {
  return role === "COMMERCE" && language === "ZH" && status === "PENDING_COMMERCE";
}

// Does the ZH PI have an effective (approved) version? True once approved, and
// it stays true while a revision of it is in progress.
export function hasEffectiveVersion(status: PiStatus, ctx: PiContext = {}): boolean {
  return status === "APPROVED" || Boolean(ctx.revisionInProgress);
}

// May the PI be deleted, by status alone? ZH is deletable only as a DRAFT that
// is not a revision; EN is deletable unless locked by its approved ZH PI.
export function canDeletePiByStatus(language: Language, status: PiStatus, ctx: PiContext = {}): boolean {
  if (language === "EN") return !ctx.linkedZhApproved;
  return status === "DRAFT" && !ctx.revisionInProgress;
}
