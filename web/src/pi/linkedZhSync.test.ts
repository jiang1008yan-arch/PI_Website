import { describe, expect, it } from "vitest";
import type { Pi } from "../types";
import { canSyncLinkedZh, shouldShowLinkedZhSyncButton } from "./linkedZhSync";

const enPi = { id: "pi-1", language: "EN", status: "DRAFT" } as Pi;

describe("linked ZH sync button", () => {
  it("is always visible on the English workspace, including a brand-new PI", () => {
    expect(shouldShowLinkedZhSyncButton("EN")).toBe(true);
  });

  it("is hidden on the Chinese workspace", () => {
    expect(shouldShowLinkedZhSyncButton("ZH")).toBe(false);
  });

  it("can only sync once an English PI is saved", () => {
    expect(canSyncLinkedZh("EN", null, null)).toBe(false);
    expect(canSyncLinkedZh("EN", enPi, null)).toBe(true);
    expect(canSyncLinkedZh("ZH", enPi, null)).toBe(false);
  });

  it("keeps existing linked Chinese drafts syncable only while editable", () => {
    expect(canSyncLinkedZh("EN", enPi, { id: "zh-1", piNo: "CN-1", status: "DRAFT" })).toBe(true);
    expect(canSyncLinkedZh("EN", enPi, { id: "zh-1", piNo: "CN-1", status: "REJECTED" })).toBe(true);
    expect(canSyncLinkedZh("EN", enPi, { id: "zh-1", piNo: "CN-1", status: "PENDING_REVIEW" })).toBe(false);
    expect(canSyncLinkedZh("EN", enPi, { id: "zh-1", piNo: "CN-1", status: "APPROVED" })).toBe(false);
  });
});
