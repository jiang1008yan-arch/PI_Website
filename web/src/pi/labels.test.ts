import { describe, expect, it } from "vitest";
import type { Pi } from "../types";
import { piDisplayName } from "./labels";

function pi(overrides: Partial<Pi>): Pi {
  return {
    id: "pi-1",
    language: "ZH",
    piNo: "PI-ZH-001",
    status: "DRAFT",
    date: "2026-05-31",
    customerCompany: "Acme",
    ...overrides
  };
}

describe("piDisplayName", () => {
  it("keeps using the linked English PI snapshot when the live link is gone", () => {
    expect(
      piDisplayName(
        pi({
          linkedPiNo: null,
          linkedPiNoSnapshot: "PI-EN-001",
          productionOrderNo: "PO-001"
        }),
        "ZH"
      )
    ).toBe("PI-EN-001");
  });

  it("prefers the live linked English PI No while it exists", () => {
    expect(
      piDisplayName(
        pi({
          linkedPiNo: "PI-EN-LIVE",
          linkedPiNoSnapshot: "PI-EN-SNAPSHOT"
        }),
        "ZH"
      )
    ).toBe("PI-EN-LIVE");
  });
});
