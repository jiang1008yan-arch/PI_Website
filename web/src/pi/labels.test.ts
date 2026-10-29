import { describe, expect, it } from "vitest";
import type { Pi } from "../types";
import { piDisplayName, piStatusLabel, reviewEventLabel } from "./labels";

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

describe("approval labels", () => {
  it("names the two ZH approval steps", () => {
    expect(piStatusLabel("PENDING_REVIEW")).toBe("Pending presales confirmation");
    expect(piStatusLabel("PENDING_COMMERCE")).toBe("Pending commerce approval");
    expect(piStatusLabel("SUBMITTED", "EN")).toBe("Submitted");
  });

  it("describes review events with their step and revision", () => {
    expect(reviewEventLabel({ id: "e", action: "APPROVED", step: "PRESALES", revisionNo: 1, createdAt: "" })).toBe("Rev 1 · Presales confirmed");
    expect(reviewEventLabel({ id: "e", action: "APPROVED", step: "COMMERCE", revisionNo: 2, createdAt: "" })).toBe("Rev 2 · Commerce approved");
    expect(reviewEventLabel({ id: "e", action: "REJECTED", step: "COMMERCE", createdAt: "" })).toBe("Rev 1 · Commerce rejected");
    expect(reviewEventLabel({ id: "e", action: "REVISION_STARTED", revisionNo: 2, createdAt: "" })).toBe("Rev 2 · Revision started");
  });
});
