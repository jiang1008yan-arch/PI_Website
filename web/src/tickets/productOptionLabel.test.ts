import { describe, expect, it } from "vitest";
import { ticketProductOptionLabel } from "./productOptionLabel";

describe("ticketProductOptionLabel", () => {
  it("shows only the English product name on after-sales forms", () => {
    expect(ticketProductOptionLabel({
      id: "p1",
      code: "P-001",
      nameEn: "Injet Swift 2.0 AC EV Charger",
      nameZh: "Injet Swift 2.0\u7535\u52a8\u6c7d\u8f66\u4ea4\u6d41\u6869"
    })).toBe("Injet Swift 2.0 AC EV Charger");
  });

  it("falls back to the product code if the English name is empty", () => {
    expect(ticketProductOptionLabel({
      id: "p1",
      code: "P-001",
      nameEn: "",
      nameZh: "\u4ea7\u54c1"
    })).toBe("P-001");
  });
});
