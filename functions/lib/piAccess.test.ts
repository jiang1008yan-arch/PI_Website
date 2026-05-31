import { describe, expect, it } from "vitest";
import {
  canApprovePi,
  canDeletePi,
  canExportPi,
  canPatchPi,
  canReadPi,
  canRejectPi,
  canSubmitForReview,
  canSubmitPi,
  isReviewerEditMode,
  type PiRow,
  type PiStatus,
  type Verdict
} from "./piAccess";
import type { AppUser, Language } from "./types";

const ADMIN: AppUser = { id: "admin-1", username: "admin", displayName: "Admin", role: "ADMIN" };
const OWNER: AppUser = { id: "user-1", username: "alice", displayName: "Alice", role: "SALES" };
const STRANGER: AppUser = { id: "user-2", username: "bob", displayName: "Bob", role: "SALES" };

const pi = (overrides: Partial<PiRow> = {}): PiRow => ({
  id: "pi-1",
  language: "EN",
  status: "DRAFT",
  createdById: OWNER.id,
  ...overrides
});

const STATUSES: PiStatus[] = ["DRAFT", "SUBMITTED", "PENDING_REVIEW", "APPROVED", "REJECTED"];
const LANGUAGES: Language[] = ["EN", "ZH"];

const expectAllowed = (v: Verdict) => expect(v).toEqual({ allowed: true });
const expectDenied = (v: Verdict, status: 400 | 403 | 404) => {
  expect(v.allowed).toBe(false);
  if (!v.allowed) expect(v.status).toBe(status);
};

describe("canReadPi", () => {
  it("owner can read own PI in any language/status", () => {
    for (const language of LANGUAGES) for (const status of STATUSES) {
      expectAllowed(canReadPi(OWNER, pi({ language, status })));
    }
  });
  it("admin can read any PI", () => {
    for (const language of LANGUAGES) for (const status of STATUSES) {
      expectAllowed(canReadPi(ADMIN, pi({ language, status })));
    }
  });
  it("stranger cannot read someone else's PI", () => {
    expectDenied(canReadPi(STRANGER, pi()), 403);
  });
});

describe("canDeletePi", () => {
  it("EN drafts: owner and admin can delete", () => {
    expectAllowed(canDeletePi(OWNER, pi({ language: "EN", status: "DRAFT" })));
    expectAllowed(canDeletePi(ADMIN, pi({ language: "EN", status: "DRAFT" })));
  });
  it("EN non-draft: stranger denied as forbidden, but allowed for owner/admin (EN has no status restriction)", () => {
    expectAllowed(canDeletePi(OWNER, pi({ language: "EN", status: "SUBMITTED" })));
    expectDenied(canDeletePi(STRANGER, pi({ language: "EN", status: "SUBMITTED" })), 403);
  });
  it("ZH non-DRAFT cannot be deleted by anyone", () => {
    for (const status of STATUSES.filter((s) => s !== "DRAFT")) {
      expectDenied(canDeletePi(OWNER, pi({ language: "ZH", status })), 400);
      expectDenied(canDeletePi(ADMIN, pi({ language: "ZH", status })), 400);
    }
  });
  it("ZH DRAFT: owner and admin can delete", () => {
    expectAllowed(canDeletePi(OWNER, pi({ language: "ZH", status: "DRAFT" })));
    expectAllowed(canDeletePi(ADMIN, pi({ language: "ZH", status: "DRAFT" })));
  });
  it("stranger cannot delete", () => {
    expectDenied(canDeletePi(STRANGER, pi({ language: "EN", status: "DRAFT" })), 403);
    expectDenied(canDeletePi(STRANGER, pi({ language: "ZH", status: "DRAFT" })), 403);
  });
});

describe("canPatchPi", () => {
  it("EN: owner and admin can patch in any status", () => {
    for (const status of STATUSES) {
      expectAllowed(canPatchPi(OWNER, pi({ language: "EN", status })));
      expectAllowed(canPatchPi(ADMIN, pi({ language: "EN", status })));
    }
  });
  it("ZH DRAFT/REJECTED: owner and admin can patch", () => {
    for (const status of ["DRAFT", "REJECTED"] as PiStatus[]) {
      expectAllowed(canPatchPi(OWNER, pi({ language: "ZH", status })));
      expectAllowed(canPatchPi(ADMIN, pi({ language: "ZH", status })));
    }
  });
  it("ZH PENDING_REVIEW is locked for everyone (admin uses approve/reject for edits)", () => {
    expectDenied(canPatchPi(ADMIN, pi({ language: "ZH", status: "PENDING_REVIEW" })), 400);
    expectDenied(canPatchPi(OWNER, pi({ language: "ZH", status: "PENDING_REVIEW" })), 400);
  });
  it("ZH SUBMITTED/APPROVED is locked", () => {
    for (const status of ["SUBMITTED", "APPROVED"] as PiStatus[]) {
      expectDenied(canPatchPi(OWNER, pi({ language: "ZH", status })), 400);
      expectDenied(canPatchPi(ADMIN, pi({ language: "ZH", status })), 400);
    }
  });
  it("stranger cannot patch", () => {
    expectDenied(canPatchPi(STRANGER, pi()), 403);
  });
});

describe("canSubmitPi", () => {
  it("ZH PI returns 404 (this action is EN-only)", () => {
    expectDenied(canSubmitPi(OWNER, pi({ language: "ZH" })), 404);
  });
  it("EN: owner and admin allowed; stranger forbidden", () => {
    expectAllowed(canSubmitPi(OWNER, pi({ language: "EN" })));
    expectAllowed(canSubmitPi(ADMIN, pi({ language: "EN" })));
    expectDenied(canSubmitPi(STRANGER, pi({ language: "EN" })), 403);
  });
});

describe("canSubmitForReview", () => {
  it("EN PI returns 404 (this action is ZH-only)", () => {
    expectDenied(canSubmitForReview(OWNER, pi({ language: "EN" })), 404);
  });
  it("ZH: owner and admin allowed; stranger forbidden", () => {
    expectAllowed(canSubmitForReview(OWNER, pi({ language: "ZH" })));
    expectAllowed(canSubmitForReview(ADMIN, pi({ language: "ZH" })));
    expectDenied(canSubmitForReview(STRANGER, pi({ language: "ZH" })), 403);
  });
});

describe("canApprovePi / canRejectPi", () => {
  it("only admin can approve or reject", () => {
    expectDenied(canApprovePi(OWNER, pi({ language: "ZH", status: "PENDING_REVIEW" })), 403);
    expectDenied(canRejectPi(OWNER, pi({ language: "ZH", status: "PENDING_REVIEW" })), 403);
  });
  it("admin can approve a ZH PENDING_REVIEW", () => {
    expectAllowed(canApprovePi(ADMIN, pi({ language: "ZH", status: "PENDING_REVIEW" })));
    expectAllowed(canRejectPi(ADMIN, pi({ language: "ZH", status: "PENDING_REVIEW" })));
  });
  it("admin cannot approve a non-PENDING_REVIEW PI", () => {
    for (const status of STATUSES.filter((s) => s !== "PENDING_REVIEW")) {
      expectDenied(canApprovePi(ADMIN, pi({ language: "ZH", status })), 400);
    }
  });
  it("admin cannot approve an EN PI even if status would otherwise allow", () => {
    expectDenied(canApprovePi(ADMIN, pi({ language: "EN", status: "PENDING_REVIEW" })), 400);
  });
});

describe("canExportPi", () => {
  it("ZH: only admin, only APPROVED", () => {
    expectAllowed(canExportPi(ADMIN, pi({ language: "ZH", status: "APPROVED" })));
    expectDenied(canExportPi(OWNER, pi({ language: "ZH", status: "APPROVED" })), 403);
    for (const status of STATUSES.filter((s) => s !== "APPROVED")) {
      expectDenied(canExportPi(ADMIN, pi({ language: "ZH", status })), 403);
    }
  });
  it("EN: owner and admin can export, stranger forbidden", () => {
    for (const status of STATUSES) {
      expectAllowed(canExportPi(OWNER, pi({ language: "EN", status })));
      expectAllowed(canExportPi(ADMIN, pi({ language: "EN", status })));
      expectDenied(canExportPi(STRANGER, pi({ language: "EN", status })), 403);
    }
  });
});

describe("isReviewerEditMode", () => {
  it("true only for admin on ZH PENDING_REVIEW", () => {
    expect(isReviewerEditMode(ADMIN, pi({ language: "ZH", status: "PENDING_REVIEW" }))).toBe(true);
  });
  it("false for non-admin", () => {
    expect(isReviewerEditMode(OWNER, pi({ language: "ZH", status: "PENDING_REVIEW" }))).toBe(false);
  });
  it("false for EN", () => {
    expect(isReviewerEditMode(ADMIN, pi({ language: "EN", status: "PENDING_REVIEW" }))).toBe(false);
  });
  it("false for any non-PENDING_REVIEW status", () => {
    for (const status of STATUSES.filter((s) => s !== "PENDING_REVIEW")) {
      expect(isReviewerEditMode(ADMIN, pi({ language: "ZH", status }))).toBe(false);
    }
  });
});
