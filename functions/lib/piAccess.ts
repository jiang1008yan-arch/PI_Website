import type { AppUser, Language } from "./types";
import {
  canDeletePiByStatus,
  canEditPiDirectly,
  isReviewerEditMode as reviewerEditModeByStatus
} from "../../shared/piCapabilities";

export type PiStatus = "DRAFT" | "SUBMITTED" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";

export type PiRow = {
  id: string;
  language: Language;
  status: PiStatus;
  createdById: string;
  linkedPiId?: string | null;
};

export type Verdict =
  | { allowed: true }
  | { allowed: false; reason: string; status: 400 | 403 | 404 };

const ALLOW: Verdict = { allowed: true };
const deny = (reason: string, status: 400 | 403 | 404): Verdict => ({ allowed: false, reason, status });

const isAdmin = (user: AppUser) => user.role === "ADMIN";
const owns = (user: AppUser, pi: PiRow) => pi.createdById === user.id;
const ownerOrAdmin = (user: AppUser, pi: PiRow) => isAdmin(user) || owns(user, pi);

export function canReadPi(user: AppUser, pi: PiRow): Verdict {
  if (!ownerOrAdmin(user, pi)) return deny("Forbidden", 403);
  return ALLOW;
}

export function canDeletePi(user: AppUser, pi: PiRow): Verdict {
  if (!canDeletePiByStatus(pi.language, pi.status)) {
    return deny("Only draft Chinese PIs can be deleted", 400);
  }
  if (!ownerOrAdmin(user, pi)) return deny("Forbidden", 403);
  return ALLOW;
}

export function canPatchPi(user: AppUser, pi: PiRow): Verdict {
  if (!ownerOrAdmin(user, pi)) return deny("Forbidden", 403);
  if (canEditPiDirectly(pi.language, pi.status)) return ALLOW;
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

export function canApprovePi(user: AppUser, pi: PiRow): Verdict {
  if (!isAdmin(user)) return deny("Forbidden", 403);
  if (pi.language !== "ZH" || pi.status !== "PENDING_REVIEW") {
    return deny("PI is not pending review", 400);
  }
  return ALLOW;
}

export function canRejectPi(user: AppUser, pi: PiRow): Verdict {
  return canApprovePi(user, pi);
}

export function canExportPi(user: AppUser, pi: PiRow): Verdict {
  if (pi.language === "ZH") {
    if (!isAdmin(user)) return deny("Chinese PIs can only be exported by admins", 403);
    if (pi.status !== "APPROVED") return deny("Chinese PI must be confirmed before export", 403);
    return ALLOW;
  }
  if (!ownerOrAdmin(user, pi)) return deny("Forbidden", 403);
  return ALLOW;
}

export function isReviewerEditMode(user: AppUser, pi: PiRow): boolean {
  return reviewerEditModeByStatus(user.role, pi.language, pi.status);
}
