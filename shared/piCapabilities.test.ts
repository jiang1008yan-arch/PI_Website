import { describe, expect, it } from "vitest";
import {
  canDeletePiByStatus,
  canEditPiDirectly,
  isReviewerEditMode,
  type PiStatus,
  type Role
} from "./piCapabilities";

const ALL_STATUSES: PiStatus[] = ["DRAFT", "SUBMITTED", "PENDING_REVIEW", "APPROVED", "REJECTED"];
const NON_ADMIN: Role[] = ["SALES", "SERVICE"];

describe("canEditPiDirectly", () => {
  it("EN is always directly writable, regardless of status", () => {
    for (const status of ALL_STATUSES) expect(canEditPiDirectly("EN", status)).toBe(true);
  });

  it("ZH is directly writable only as DRAFT or REJECTED", () => {
    expect(canEditPiDirectly("ZH", "DRAFT")).toBe(true);
    expect(canEditPiDirectly("ZH", "REJECTED")).toBe(true);
    for (const status of ["SUBMITTED", "PENDING_REVIEW", "APPROVED"] as PiStatus[]) {
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
  it("EN is deletable in any status", () => {
    for (const status of ALL_STATUSES) expect(canDeletePiByStatus("EN", status)).toBe(true);
  });

  it("ZH is deletable only as a DRAFT", () => {
    expect(canDeletePiByStatus("ZH", "DRAFT")).toBe(true);
    for (const status of ALL_STATUSES.filter((s) => s !== "DRAFT")) {
      expect(canDeletePiByStatus("ZH", status)).toBe(false);
    }
  });
});
