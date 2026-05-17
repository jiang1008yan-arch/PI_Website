import { describe, expect, it } from "vitest";
import { parsePiItem, parsePiItems } from "./piItemCodec";

describe("parsePiItem", () => {
  it("parses a valid JSON string into a typed FieldValue array", () => {
    const wire = {
      id: "i1",
      productId: "p1",
      fieldValues: JSON.stringify([
        { label: "Color", value: "Red", fieldType: "TEXT", sortOrder: 0 }
      ])
    };
    const parsed = parsePiItem(wire);
    expect(parsed.fieldValues).toEqual([
      { label: "Color", value: "Red", fieldType: "TEXT", sortOrder: 0 }
    ]);
    expect(parsed.id).toBe("i1");
    expect(parsed.productId).toBe("p1");
  });

  it("returns [] for null, empty string, and undefined", () => {
    expect(parsePiItem({ fieldValues: null }).fieldValues).toEqual([]);
    expect(parsePiItem({ fieldValues: "" }).fieldValues).toEqual([]);
    expect(parsePiItem({ fieldValues: undefined as unknown as string }).fieldValues).toEqual([]);
  });

  it("returns [] when the stored value is not an array (defensive)", () => {
    expect(parsePiItem({ fieldValues: JSON.stringify({ not: "array" }) }).fieldValues).toEqual([]);
  });

  it("throws on malformed JSON", () => {
    expect(() => parsePiItem({ fieldValues: "{not json" })).toThrow();
  });

  it("preserves array order", () => {
    const fields = [
      { label: "A", value: "1", fieldType: "TEXT", sortOrder: 0 },
      { label: "B", value: "2", fieldType: "TEXT", sortOrder: 1 },
      { label: "C", value: "3", fieldType: "TEXT", sortOrder: 2 }
    ];
    const parsed = parsePiItem({ fieldValues: JSON.stringify(fields) });
    expect(parsed.fieldValues.map((f) => f.label)).toEqual(["A", "B", "C"]);
  });

  it("passes __-prefixed meta labels through unchanged", () => {
    const wire = {
      fieldValues: JSON.stringify([
        { label: "__currency", value: "USD", fieldType: "TEXT", sortOrder: -1 },
        { label: "Color", value: "Red", fieldType: "TEXT", sortOrder: 0 }
      ])
    };
    expect(parsePiItem(wire).fieldValues[0].label).toBe("__currency");
  });

  it("preserves extra fields on the wire row (id, sortOrder, joined product columns)", () => {
    const wire = {
      id: "i1",
      productId: "p1",
      sortOrder: 3,
      code: "PROD-1",
      nameEn: "Widget",
      nameZh: "小部件",
      quantity: 2,
      fieldValues: "[]"
    };
    const parsed = parsePiItem(wire);
    expect(parsed.code).toBe("PROD-1");
    expect(parsed.nameZh).toBe("小部件");
    expect(parsed.quantity).toBe(2);
    expect(parsed.sortOrder).toBe(3);
  });
});

describe("parsePiItems", () => {
  it("maps over an array", () => {
    const wires = [
      { id: "i1", fieldValues: "[]" },
      { id: "i2", fieldValues: JSON.stringify([{ label: "X", value: "y", fieldType: "TEXT", sortOrder: 0 }]) }
    ];
    const parsed = parsePiItems(wires);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].fieldValues).toEqual([]);
    expect(parsed[1].fieldValues[0].label).toBe("X");
  });

  it("handles an empty array", () => {
    expect(parsePiItems([])).toEqual([]);
  });
});
