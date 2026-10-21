import type { AppUser, Language } from "./types";
import {
  canActOnCommerce,
  canActOnPresales,
  canDeletePiByStatus,
  canEditPiDirectly,
  hasEffectiveVersion,
  isCommerceDecisionMode,
  isReviewerEditMode as reviewerEditModeByStatus,
  type PiContext
} from "../../shared/piCapabilities";

export type PiStatus = "DRAFT" | "SUBMITTED" | "PENDING_REVIEW" | "PENDING_COMMERCE" | "APPROVED" | "REJECTED";

export type PiRow = {
  id: string;
  language: Language;
  status: PiStatus;
  createdById: string;
  // ZH: the presales approver picked at submit (PENDING_REVIEW) / the recipient.
  assignedToId?: string | null;
  // ZH: the commerce approver picked at submit.
  commerceId?: string | null;
  linkedPiId?: string | null;
  // ZH only: 1 while a revision of an approved PI is in progress.
  revisionInProgress?: number | boolean | null;
  // EN only, loaded by the route when the EN PI is linked: the linked ZH PI's
  // status and revision flag (an EN PI follows its ZH PI's lock).
  linkedZh?: { status: PiStatus; revisionInProgress?: number | boolean | null } | null;
};

export type ExportVersion = "current" | "effective";

export type Verdict =
  | { allowed: true }
  | { allowed: false; reason: string; status: 400 | 403 | 404 };

const ALLOW: Verdict = { allowed: true };
const deny = (reason: string, status: 400 | 403 | 404): Verdict => ({ allowed: false, reason, status });

const isAdmin = (user: AppUser) => user.role === "ADMIN";
const owns = (user: AppUser, pi: PiRow) => pi.createdById === user.id;
const ownerOrAdmin = (user: AppUser, pi: PiRow) => isAdmin(user) || owns(user, pi);

function contextOf(pi: PiRow): PiContext {
  return {
    linkedZhApproved: pi.language === "EN" && pi.linkedZh?.status === "APPROVED",
    revisionInProgress: Boolean(pi.revisionInProgress)
  };
}

// May commerce see this ZH PI? While it awaits their decision, and whenever it
// has an effective (approved) version.
function commerceCanSeeZh(status: PiStatus, revisionInProgress: unknown): boolean {
  return status === "PENDING_COMMERCE" || hasEffectiveVersion(status, { revisionInProgress: Boolean(revisionInProgress) });
}

// Editor read (GET /pi/:id): the live row, for its owner or an admin. PRESALES
// works across every Chinese PI (they edit in review mode at their step).
export function canReadPi(user: AppUser, pi: PiRow): Verdict {
  if (user.role === "PRESALES" && pi.language === "ZH") return ALLOW;
  if (!ownerOrAdmin(user, pi)) return deny("Forbidden", 403);
  return ALLOW;
}

// Read-only detail page (GET /pi/:id/view) for a ZH PI and its linked EN PI.
export function canViewPi(user: AppUser, pi: PiRow): Verdict {
  if (pi.language !== "ZH") return deny("Chinese PI not found", 404);
  if (isAdmin(user) || user.role === "PRESALES") return ALLOW;
  if (user.role === "SALES") {
    return owns(user, pi) || pi.assignedToId === user.id ? ALLOW : deny("Forbidden", 403);
  }
  if (user.role === "COMMERCE") {
    return commerceCanSeeZh(pi.status, pi.revisionInProgress) ? ALLOW : deny("Forbidden", 403);
  }
  // SERVICE: PIs that have been approved (what tickets point at), in full and
  // read-only — current and approved versions and the linked English PI.
  return hasEffectiveVersion(pi.status, contextOf(pi)) ? ALLOW : deny("Forbidden", 403);
}

export function canDeletePi(user: AppUser, pi: PiRow): Verdict {
  if (!canDeletePiByStatus(pi.language, pi.status, contextOf(pi))) {
    return deny(
      pi.language === "EN" ? "This PI is locked by its approved Chinese PI" : "Only draft Chinese PIs can be deleted",
      400
    );
  }
  if (!ownerOrAdmin(user, pi)) return deny("Forbidden", 403);
  return ALLOW;
}

export function canPatchPi(user: AppUser, pi: PiRow): Verdict {
  if (!ownerOrAdmin(user, pi)) return deny("Forbidden", 403);
  if (canEditPiDirectly(pi.language, pi.status, contextOf(pi))) return ALLOW;
  return deny("PI is locked", 400);
}

export function canSubmitPi(user: AppUser, pi: PiRow): Verdict {
  if (pi.language !== "EN") return deny("English PI not found", 404);
  if (!ownerOrAdmin(user, pi)) return deny("Forbidden", 403);
  return ALLOW;
}

export function canSubmitForReview(user: AppUser, pi: PiRow): Verdict {
  if (pi.language !== "ZH") return deny("Chinese PI not found", 404);
  if (!ownerOrAdmin(user, pi)) return deny("Forbidden", 403);
  return ALLOW;
}

// Presales confirmation (the first step) on a ZH PENDING_REVIEW PI: the
// PRESALES user picked at submit, or any ADMIN.
export function canApprovePi(user: AppUser, pi: PiRow): Verdict {
  if (!isAdmin(user) && user.role !== "PRESALES") return deny("Forbidden", 403);
  if (pi.language !== "ZH" || pi.status !== "PENDING_REVIEW") {
    return deny("PI is not pending review", 400);
  }
  if (!canActOnPresales(user.role, user.id, pi)) return deny("This PI is waiting for another presales approver", 403);
  return ALLOW;
}

export function canRejectPi(user: AppUser, pi: PiRow): Verdict {
  return canApprovePi(user, pi);
}

// Commerce approval (the final step): the picked commerce user, or any ADMIN.
export function canCommerceDecide(user: AppUser, pi: PiRow): Verdict {
  if (user.role !== "COMMERCE" && !isAdmin(user)) return deny("Only commerce or an admin can approve this step", 403);
  if (!isCommerceDecisionMode(user.role, pi.language, pi.status)) {
    return deny("PI is not awaiting commerce approval", 400);
  }
  if (!canActOnCommerce(user.role, user.id, pi)) return deny("This PI is waiting for another commerce approver", 403);
  return ALLOW;
}

export function canStartRevision(user: AppUser, pi: PiRow): Verdict {
  if (pi.language !== "ZH") return deny("Chinese PI not found", 404);
  if (!ownerOrAdmin(user, pi)) return deny("Forbidden", 403);
  if (pi.revisionInProgress) return deny("A revision is already in progress", 400);
  if (pi.status !== "APPROVED") return deny("Only approved PIs can be revised", 400);
  return ALLOW;
}

export function canAbandonRevision(user: AppUser, pi: PiRow): Verdict {
  if (pi.language !== "ZH") return deny("Chinese PI not found", 404);
  if (!ownerOrAdmin(user, pi)) return deny("Forbidden", 403);
  if (!pi.revisionInProgress) return deny("No revision in progress", 400);
  if (pi.status !== "DRAFT" && pi.status !== "REJECTED") {
    return deny("A revision under review cannot be abandoned", 400);
  }
  return ALLOW;
}

// Excel export. `effective` exports the approved content (the snapshot while a
// revision is in progress); `current` exports the live row.
export function canExportPi(user: AppUser, pi: PiRow, version: ExportVersion = "current"): Verdict {
  if (user.role === "SERVICE") return deny("After-sales cannot download PIs", 403);
  if (pi.language === "ZH") {
    if (user.role !== "ADMIN" && user.role !== "COMMERCE") {
      return deny("Chinese PIs can only be exported by admins or commerce", 403);
    }
    if (version === "effective") {
      return hasEffectiveVersion(pi.status, contextOf(pi)) ? ALLOW : deny("Chinese PI has no approved version", 403);
    }
    if (pi.status === "APPROVED") return ALLOW;
    if (user.role === "COMMERCE" && pi.status === "PENDING_COMMERCE") return ALLOW;
    return deny("Chinese PI must be approved before export", 403);
  }
  if (user.role === "COMMERCE") {
    const zh = pi.linkedZh;
    return zh && commerceCanSeeZh(zh.status, zh.revisionInProgress) ? ALLOW : deny("Forbidden", 403);
  }
  if (!ownerOrAdmin(user, pi)) return deny("Forbidden", 403);
  return ALLOW;
}

export function isReviewerEditMode(user: AppUser, pi: PiRow): boolean {
  return reviewerEditModeByStatus(user.role, pi.language, pi.status) && canActOnPresales(user.role, user.id, pi);
}
