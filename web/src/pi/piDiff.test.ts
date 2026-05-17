import { describe, expect, it } from "vitest";
import { computePiDiff, isPiDirty, type PiSnapshot } from "./piDiff";

const snap = (overrides: Partial<PiSnapshot> = {}): PiSnapshot => ({
  header: { piNo: "PI-1", customerCompany: "Acme", customerEmail: "a@b.c" },
  items: [
    { id: "i1", productId: "p1", quantity: 1, unitPrice: 100, discountPct: 0, fieldValues: [] } as any
  ],
  ...overrides
});

describe("computePiDiff", () => {
  it("returns null when nothing changed", () => {
    expect(computePiDiff(snap(), snap())).toBeNull();
  });

  it("captures header field changes", () => {
    const before = snap();
    const after = snap({ header: { ...before.header, customerCompany: "Acme Corp" } });
    expect(computePiDiff(before, after)).toEqual({
      header: { customerCompany: ["Acme", "Acme Corp"] },
      items: { added: [], removed: [], modified: [] }
    });
  });

  it("ignores timestamp and bookkeeping fields", () => {
    const before = snap({ header: { ...snap().header, updatedAt: "old", createdAt: "old" } });
    const after = snap({ header: { ...snap().header, updatedAt: "new", createdAt: "new" } });
    expect(computePiDiff(before, after)).toBeNull();
  });

  it("detects added items (no id) and removed items", () => {
    const before = snap();
    const after = snap({
      items: [
        ...snap().items,
        { productId: "p2", quantity: 2, unitPrice: 50, discountPct: 0, fieldValues: [] } as any
      ]
    });
    const diff = computePiDiff(before, after);
    expect(diff?.items.added).toHaveLength(1);
    expect(diff?.items.removed).toHaveLength(0);

    const removed = computePiDiff(snap(), snap({ items: [] }));
    expect(removed?.items.removed).toHaveLength(1);
    expect(removed?.items.added).toHaveLength(0);
  });

  it("detects modified numeric fields on existing items", () => {
    const before = snap();
    const after = snap({
      items: [{ ...snap().items[0], unitPrice: 120 } as any]
    });
    const diff = computePiDiff(before, after);
    expect(diff?.items.modified).toEqual([
      { id: "i1", changes: { unitPrice: [100, 120] } }
    ]);
  });

  it("treats fieldValues as a JSON-comparable bag", () => {
    const before = snap({
      items: [{ ...snap().items[0], fieldValues: [{ label: "Color", value: "red" }] } as any]
    });
    const after = snap({
      items: [{ ...snap().items[0], fieldValues: [{ label: "Color", value: "blue" }] } as any]
    });
    const diff = computePiDiff(before, after);
    expect(diff?.items.modified[0].changes).toHaveProperty("fieldValues");
  });

  it("treats null and undefined header values as empty strings", () => {
    const before = snap({ header: { ...snap().header, customerEmail: null } });
    const after = snap({ header: { ...snap().header, customerEmail: "" } });
    expect(computePiDiff(before, after)).toBeNull();
  });
});

describe("isPiDirty", () => {
  it("returns false for a fresh editor with no canonical and empty state", () => {
    expect(isPiDirty(null, { header: { customerCompany: "" }, items: [] })).toBe(false);
  });

  it("returns true when customerCompany has been typed into (no canonical)", () => {
    expect(isPiDirty(null, { header: { customerCompany: "Acme" }, items: [] })).toBe(true);
  });

  it("ignores whitespace-only customerCompany (no canonical)", () => {
    expect(isPiDirty(null, { header: { customerCompany: "   " }, items: [] })).toBe(false);
  });

  it("returns true when any item has been added (no canonical)", () => {
    const item: any = { productId: "p1", quantity: 1, unitPrice: 0, discountPct: 0, fieldValues: [] };
    expect(isPiDirty(null, { header: { customerCompany: "" }, items: [item] })).toBe(true);
  });

  it("returns false when canonical matches edits exactly", () => {
    const s = snap();
    expect(isPiDirty(s, s)).toBe(false);
  });

  it("returns true when edits diverge from canonical", () => {
    const before = snap();
    const after = snap({ header: { ...before.header, customerCompany: "Acme Corp" } });
    expect(isPiDirty(before, after)).toBe(true);
  });
});
