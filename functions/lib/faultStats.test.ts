import { describe, expect, it } from "vitest";
import { parseSerials } from "./devices";
import { buildFaultRanking, isRepeatFault, repeatSettings, repeatWindowStart } from "./faultStats";

describe("buildFaultRanking", () => {
  const t = (id: string, productId: string | null, productModel: string | null, faultType: string, createdAt: string) => ({
    id,
    ticketNo: id.toUpperCase(),
    customerCompany: "ACME",
    createdAt,
    productId,
    productName: productId ? `Product ${productId}` : null,
    productModel,
    faultType
  });
  const settings = { windowDays: 90, threshold: 3 };

  it("ranks product · model · fault rows by count, then by most recent", () => {
    const rows = buildFaultRanking(
      [
        t("t1", "p1", "AC-EU", "Offline", "2026-10-01 00:00:00"),
        t("t2", "p1", "AC-EU", "Offline", "2026-10-05 00:00:00"),
        t("t3", "p1", " AC-UK ", "Offline", "2026-09-01 00:00:00"),
        t("t4", "p2", "", "Screen", "2026-10-10 00:00:00"),
        t("t5", null, null, "Screen", "2026-08-01 00:00:00")
      ],
      [],
      settings
    );
    expect(rows.map((r) => [r.productName, r.productModel, r.faultType, r.n, r.lastAt])).toEqual([
      ["Product p1", "AC-EU", "Offline", 2, "2026-10-05 00:00:00"],
      ["Product p2", null, "Screen", 1, "2026-10-10 00:00:00"],
      ["Product p1", "AC-UK", "Offline", 1, "2026-09-01 00:00:00"],
      ["(no product)", null, "Screen", 1, "2026-08-01 00:00:00"]
    ]);
    expect(rows[0].tickets.map((x) => x.id)).toEqual(["t2", "t1"]);
  });

  it("judges repeat faults per product across its models", () => {
    const rows = buildFaultRanking(
      [
        t("t1", "p1", "AC-EU", "Offline", "2026-10-01 00:00:00"),
        t("t2", "p1", "AC-UK", "Offline", "2026-10-02 00:00:00"),
        t("t3", "p2", null, "Offline", "2026-10-03 00:00:00"),
        t("t4", null, null, "Offline", "2026-10-04 00:00:00")
      ],
      [
        { productId: "p1", faultType: "Offline", n: 4 },
        { productId: "p2", faultType: "Offline", n: 2 },
        { productId: null, faultType: "Offline", n: 5 }
      ],
      settings
    );
    const byId = Object.fromEntries(rows.map((r) => [r.tickets[0].id, [r.productTotal, r.isRepeat]]));
    expect(byId).toEqual({ t1: [4, true], t2: [4, true], t3: [2, false], t4: [5, false] });
  });

  it("ignores tickets without a confirmed fault type", () => {
    expect(buildFaultRanking([t("t1", "p1", null, "", "2026-10-01 00:00:00")], [], settings)).toEqual([]);
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
