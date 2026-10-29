import { describe, expect, it } from "vitest";
import { assembleLayers, normalizeCustomer, SIMILAR_PER_LAYER, type SimilarTicket } from "./similarTickets";

describe("customer names compared loosely", () => {
  it("ignores case, spacing, punctuation and company forms", () => {
    const same = ["Iberia Charge SL", "IBERIA CHARGE, S.L.", "iberia  charge", "Iberia-Charge S.L"];
    expect(new Set(same.map(normalizeCustomer))).toEqual(new Set(["iberiacharge"]));
    expect(normalizeCustomer("ACME Co., Ltd.")).toBe(normalizeCustomer("acme"));
    expect(normalizeCustomer("Müller GmbH & Co. KG")).toBe(normalizeCustomer("müller"));
    expect(normalizeCustomer("深圳某某科技有限公司")).toBe(normalizeCustomer("深圳某某科技"));
    expect(normalizeCustomer("深圳某某科技股份有限公司")).toBe("深圳某某科技");
  });

  it("keeps names that are only a company form, and different names apart", () => {
    expect(normalizeCustomer("Ltd")).toBe("ltd");
    expect(normalizeCustomer("公司")).toBe("公司");
    expect(normalizeCustomer("Ideas Ltd")).not.toBe(normalizeCustomer("Idea"));
    expect(normalizeCustomer("")).toBe("");
  });
});

describe("assembling the layers", () => {
  const t = (id: string, status = "RESOLVED"): SimilarTicket => ({ id, ticketNo: id, createdAt: "2026-10-01", customerCompany: "", status, summary: null });

  it("shows each ticket in its strongest layer only, a few per layer with the total", () => {
    const layers = assembleLayers(
      [
        { key: "SN", value: "SN1", rows: [t("a", "NEW")] },
        { key: "ORDER", value: "PO1", rows: [t("a"), t("b")] },
        { key: "CUSTOMER", value: "ACME", rows: [t("b"), t("c"), t("d"), t("e"), t("f")] },
        { key: "FAULT", value: "Offline", rows: [t("a"), t("b")] }
      ],
      "e"
    );
    expect(layers.map((l) => [l.key, l.tickets.map((x) => x.id), l.total, l.openDuplicate])).toEqual([
      ["SN", ["a"], 1, true],
      ["ORDER", ["b"], 1, false],
      ["CUSTOMER", ["c", "d", "f"], 3, false]
    ]);
    expect(SIMILAR_PER_LAYER).toBe(3);
  });

  it("warns about a duplicate only for an open ticket on the same device", () => {
    expect(assembleLayers([{ key: "SN", value: "SN1", rows: [t("a", "RESOLVED")] }])[0]!.openDuplicate).toBe(false);
    expect(assembleLayers([{ key: "ORDER", value: "PO", rows: [t("a", "NEW")] }])[0]!.openDuplicate).toBe(false);
  });
});
