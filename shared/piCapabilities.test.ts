import { describe, expect, it } from "vitest";
import {
  canDeletePiByStatus,
  canEditPiDirectly,
  hasEffectiveVersion,
  isCommerceDecisionMode,
  isReviewerEditMode,
  type PiStatus,
  type Role
} from "./piCapabilities";

const ALL_STATUSES: PiStatus[] = ["DRAFT", "SUBMITTED", "PENDING_REVIEW", "PENDING_COMMERCE", "APPROVED", "REJECTED"];
const NON_ADMIN: Role[] = ["SALES", "SERVICE", "COMMERCE"];

describe("canEditPiDirectly", () => {
  it("EN is directly writable in any status unless its linked ZH PI is approved", () => {
    for (const status of ALL_STATUSES) {
      expect(canEditPiDirectly("EN", status)).toBe(true);
      expect(canEditPiDirectly("EN", status, { linkedZhApproved: true })).toBe(false);
    }
  });

  it("ZH is directly writable only as DRAFT or REJECTED", () => {
    expect(canEditPiDirectly("ZH", "DRAFT")).toBe(true);
    expect(canEditPiDirectly("ZH", "REJECTED")).toBe(true);
    for (const status of ["SUBMITTED", "PENDING_REVIEW", "PENDING_COMMERCE", "APPROVED"] as PiStatus[]) {
      expect(canEditPiDirectly("ZH", status)).toBe(false);
    }
  });
});

describe("isReviewerEditMode", () => {
  it("is true only for an ADMIN on a ZH PENDING_REVIEW PI", () => {
    expect(isReviewerEditMode("ADMIN", "ZH", "PENDING_REVIEW")).toBe(true);
  });

  it("is false for non-admins even on ZH PENDING_REVIEW", () => {
    for (const role of NON_ADMIN) expect(isReviewerEditMode(role, "ZH", "PENDING_REVIEW")).toBe(false);
  });

  it("is false for EN, and for ZH in any other status", () => {
    expect(isReviewerEditMode("ADMIN", "EN", "PENDING_REVIEW")).toBe(false);
    for (const status of ALL_STATUSES.filter((s) => s !== "PENDING_REVIEW")) {
      expect(isReviewerEditMode("ADMIN", "ZH", status)).toBe(false);
    }
  });
});

describe("canDeletePiByStatus", () => {
  it("EN is deletable in any status unless its linked ZH PI is approved", () => {
    for (const status of ALL_STATUSES) {
      expect(canDeletePiByStatus("EN", status)).toBe(true);
      expect(canDeletePiByStatus("EN", status, { linkedZhApproved: true })).toBe(false);
    }
  });

  it("a ZH revision draft is never deletable", () => {
    expect(canDeletePiByStatus("ZH", "DRAFT", { revisionInProgress: true })).toBe(false);
  });

  it("ZH is deletable only as a DRAFT", () => {
    expect(canDeletePiByStatus("ZH", "DRAFT")).toBe(true);
    for (const status of ALL_STATUSES.filter((s) => s !== "DRAFT")) {
      expect(canDeletePiByStatus("ZH", status)).toBe(false);
    }
  });
});

describe("isCommerceDecisionMode", () => {
  it("is true only for COMMERCE (or ADMIN) on a ZH PENDING_COMMERCE PI", () => {
    expect(isCommerceDecisionMode("COMMERCE", "ZH", "PENDING_COMMERCE")).toBe(true);
    expect(isCommerceDecisionMode("ADMIN", "ZH", "PENDING_COMMERCE")).toBe(true);
    for (const role of ["SALES", "SERVICE", "PRESALES"] as Role[]) {
      expect(isCommerceDecisionMode(role, "ZH", "PENDING_COMMERCE")).toBe(false);
    }
    expect(isCommerceDecisionMode("COMMERCE", "EN", "PENDING_COMMERCE")).toBe(false);
    for (const status of ALL_STATUSES.filter((s) => s !== "PENDING_COMMERCE")) {
      expect(isCommerceDecisionMode("COMMERCE", "ZH", status)).toBe(false);
    }
  });
});

describe("hasEffectiveVersion", () => {
  it("is true when approved, or while a revision is in progress", () => {
    expect(hasEffectiveVersion("APPROVED")).toBe(true);
    for (const status of ALL_STATUSES.filter((s) => s !== "APPROVED")) {
      expect(hasEffectiveVersion(status)).toBe(false);
      expect(hasEffectiveVersion(status, { revisionInProgress: true })).toBe(true);
    }
  });
});
