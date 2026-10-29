import { describe, expect, it } from "vitest";
import { itemsTotal, lineAmount } from "./lineItem";

// The amount of a line, and of a PI: one formula everywhere (editor, detail
// page, Excel, the PI Assistant card).
const formula = (q: unknown, p: unknown, d: unknown) => Number(q) * Number(p) * (1 - Number(d) / 100);

describe("line amounts", () => {
  it("is quantity × unit price less the discount, to the same bits as before", () => {
    for (const [q, p, d] of [[2, 100, 0], [3, 19.99, 7.5], [1, 0.1, 33.3], [7, 1234.56, 12]] as const) {
      expect(lineAmount({ quantity: q, unitPrice: p, discountPct: d })).toBe(formula(q, p, d));
    }
  });

  it("reads numbers that arrive as strings", () => {
    expect(lineAmount({ quantity: "2", unitPrice: "100", discountPct: "10" })).toBe(180);
  });

  it("totals the lines in order", () => {
    const items = [
      { quantity: 3, unitPrice: 19.99, discountPct: 7.5 },
      { quantity: 1, unitPrice: 0.1, discountPct: 33.3 }
    ];
    expect(itemsTotal(items)).toBe(items.reduce((sum, it) => sum + formula(it.quantity, it.unitPrice, it.discountPct), 0));
    expect(itemsTotal([])).toBe(0);
  });
});
