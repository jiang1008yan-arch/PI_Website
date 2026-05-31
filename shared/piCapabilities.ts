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

export type Role = "ADMIN" | "SALES" | "SERVICE";
export type Language = "EN" | "ZH";
export type PiStatus = "DRAFT" | "SUBMITTED" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";

// May the PI row be written directly (PATCH / save)? EN has no lock; a ZH PI is
// directly writable only while DRAFT or REJECTED. PENDING_REVIEW edits go
// through review mode + Approve, not a direct write.
export function canEditPiDirectly(language: Language, status: PiStatus): boolean {
  if (language === "EN") return true;
  return status === "DRAFT" || status === "REJECTED";
}

// Is this an admin editing a ZH PI in review? Edits are buffered client-side and
// committed only on Approve — never a direct PATCH.
export function isReviewerEditMode(role: Role, language: Language, status: PiStatus): boolean {
  return role === "ADMIN" && language === "ZH" && status === "PENDING_REVIEW";
}

// May the PI be deleted, by status alone? ZH is deletable only as a DRAFT;
// EN carries no status-based delete lock.
export function canDeletePiByStatus(language: Language, status: PiStatus): boolean {
  return !(language === "ZH" && status !== "DRAFT");
}
