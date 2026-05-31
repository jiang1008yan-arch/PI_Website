import { describe, expect, it } from "vitest";
import type { Pi } from "../types";
import { canSyncLinkedZh, shouldShowLinkedZhSyncButton } from "./linkedZhSync";

const enPi = { id: "pi-1", language: "EN", status: "DRAFT" } as Pi;
const zhPi = { id: "pi-2", language: "ZH", status: "DRAFT" } as Pi;

describe("linked ZH sync button", () => {
  it("shows for an opened English PI even before a linked Chinese draft exists", () => {
    expect(shouldShowLinkedZhSyncButton("EN", enPi)).toBe(true);
    expect(canSyncLinkedZh("EN", enPi, null)).toBe(true);
  });

  it("does not show without an opened PI or on the Chinese workspace", () => {
    expect(shouldShowLinkedZhSyncButton("EN", null)).toBe(false);
    expect(shouldShowLinkedZhSyncButton("ZH", zhPi)).toBe(false);
  });

  it("keeps existing linked Chinese drafts syncable only while editable", () => {
    expect(canSyncLinkedZh("EN", enPi, { id: "zh-1", piNo: "CN-1", status: "DRAFT" })).toBe(true);
    expect(canSyncLinkedZh("EN", enPi, { id: "zh-1", piNo: "CN-1", status: "REJECTED" })).toBe(true);
    expect(canSyncLinkedZh("EN", enPi, { id: "zh-1", piNo: "CN-1", status: "PENDING_REVIEW" })).toBe(false);
    expect(canSyncLinkedZh("EN", enPi, { id: "zh-1", piNo: "CN-1", status: "APPROVED" })).toBe(false);
  });
});
