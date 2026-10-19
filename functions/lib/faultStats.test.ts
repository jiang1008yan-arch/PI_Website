import { describe, expect, it } from "vitest";
import { parseSerials } from "./devices";
import { buildFaultMatrix, isRepeatFault, repeatSettings, repeatWindowStart } from "./faultStats";

describe("buildFaultMatrix", () => {
  it("builds product rows and fault columns ordered by frequency", () => {
    const matrix = buildFaultMatrix([
      { productId: "p1", productName: "AC 7kW", faultType: "Offline", n: 2 },
      { productId: "p1", productName: "AC 7kW", faultType: "Screen", n: 1 },
      { productId: "p2", productName: "DC 60kW", faultType: "Offline", n: 5 },
      { productId: null, productName: null, faultType: "Screen", n: 1 }
    ]);
    expect(matrix.faultTypes).toEqual(["Offline", "Screen"]);
    expect(matrix.products.map((p) => [p.productName, p.total, p.byFault])).toEqual([
      ["DC 60kW", 5, { Offline: 5 }],
      ["AC 7kW", 3, { Offline: 2, Screen: 1 }],
      ["(no product)", 1, { Screen: 1 }]
    ]);
  });

  it("ignores rows without a confirmed fault type", () => {
    expect(buildFaultMatrix([{ productId: "p1", productName: "A", faultType: "", n: 4 }])).toEqual({ faultTypes: [], products: [] });
  });
});

describe("repeat faults", () => {
  it("defaults to 90 days and 3 occurrences, and accepts positive integers only", () => {
    expect(repeatSettings(undefined, undefined)).toEqual({ windowDays: 90, threshold: 3 });
    expect(repeatSettings("30", "2")).toEqual({ windowDays: 30, threshold: 2 });
    expect(repeatSettings("0", "-1")).toEqual({ windowDays: 90, threshold: 3 });
    expect(repeatSettings("1.5", "abc")).toEqual({ windowDays: 90, threshold: 3 });
  });

  it("computes the window start and the threshold check", () => {
    expect(repeatWindowStart(new Date("2026-10-19T12:00:00Z"), 90)).toBe("2026-07-21 12:00:00");
    expect(isRepeatFault(2, { windowDays: 90, threshold: 3 })).toBe(false);
    expect(isRepeatFault(3, { windowDays: 90, threshold: 3 })).toBe(true);
  });
});

describe("parseSerials", () => {
  it("splits pasted text, normalizes case, drops blanks and duplicates", () => {
    expect(parseSerials(" sn-001\nSN-002, sn-001;\t\nSN-003\r\n")).toEqual({ serials: ["SN-001", "SN-002", "SN-003"], invalid: [] });
  });

  it("reports entries that do not look like serial numbers", () => {
    expect(parseSerials(["AB", "OK-123", "has space", "#bad"])).toEqual({ serials: ["OK-123"], invalid: ["AB", "has space", "#bad"] });
  });
});
