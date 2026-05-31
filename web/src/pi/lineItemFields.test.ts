import { describe, expect, it } from "vitest";
import type { FieldValue, PiItem } from "../types";
import {
  findFieldValue,
  getMeta,
  getMetaValue,
  isMetaField,
  metaLabel,
  setMeta,
  setMetaValue,
  upsertField,
  upsertFieldValues,
  visibleFieldValues,
  visibleItemFields
} from "./lineItemFields";

const fv = (label: string, value: string): FieldValue => ({
  label,
  value,
  fieldType: "TEXT",
  sortOrder: 0
});

const item = (fieldValues: FieldValue[]): PiItem => ({
  productId: "p1",
  quantity: 1,
  unitPrice: 0,
  discountPct: 0,
  fieldValues
});

describe("metaLabel / isMetaField", () => {
  it("prefixes meta keys with __", () => {
    expect(metaLabel("currency")).toBe("__currency");
  });

  it("treats only __-prefixed labels as meta", () => {
    expect(isMetaField({ label: "__currency" })).toBe(true);
    expect(isMetaField({ label: "Color" })).toBe(false);
  });
});

describe("upsertFieldValues", () => {
  it("appends a new field stamped TEXT / sortOrder -1", () => {
    const out = upsertFieldValues([], "Color", "Red");
    expect(out).toEqual([{ label: "Color", value: "Red", fieldType: "TEXT", sortOrder: -1 }]);
  });

  it("replaces the value of an existing label in place, preserving other props", () => {
    const out = upsertFieldValues([fv("Color", "Red")], "Color", "Blue");
    expect(out).toEqual([{ label: "Color", value: "Blue", fieldType: "TEXT", sortOrder: 0 }]);
  });

  it("does not mutate the input array", () => {
    const input = [fv("Color", "Red")];
    upsertFieldValues(input, "Color", "Blue");
    expect(input[0].value).toBe("Red");
  });

  it("leaves sibling fields untouched when appending", () => {
    const out = upsertFieldValues([fv("A", "1")], "B", "2");
    expect(out.map((f) => [f.label, f.value])).toEqual([["A", "1"], ["B", "2"]]);
  });
});

describe("getMetaValue / setMetaValue", () => {
  it("round-trips a meta value through the __ prefix", () => {
    const out = setMetaValue([], "currency", "EUR");
    expect(out[0].label).toBe("__currency");
    expect(getMetaValue(out, "currency")).toBe("EUR");
  });

  it("returns empty string for an absent meta key", () => {
    expect(getMetaValue([fv("Color", "Red")], "currency")).toBe("");
  });

  it("does not read a visible field as meta", () => {
    expect(getMetaValue([fv("currency", "EUR")], "currency")).toBe("");
  });
});

describe("visibleFieldValues", () => {
  it("drops every __-prefixed field", () => {
    const fields = [fv("__currency", "USD"), fv("Color", "Red"), fv("__modelRule", "{}")];
    expect(visibleFieldValues(fields).map((f) => f.label)).toEqual(["Color"]);
  });
});

describe("findFieldValue", () => {
  it("finds by exact label or returns undefined", () => {
    const fields = [fv("Color", "Red")];
    expect(findFieldValue(fields, "Color")?.value).toBe("Red");
    expect(findFieldValue(fields, "Size")).toBeUndefined();
  });
});

describe("PiItem wrappers", () => {
  it("upsertField returns a new item with the field set", () => {
    const before = item([]);
    const after = upsertField(before, "Color", "Red");
    expect(after).not.toBe(before);
    expect(after.fieldValues).toEqual([{ label: "Color", value: "Red", fieldType: "TEXT", sortOrder: -1 }]);
    expect(before.fieldValues).toEqual([]);
  });

  it("getMeta/setMeta round-trip on an item, and getMeta tolerates undefined", () => {
    const withCurrency = setMeta(item([]), "currency", "CNY");
    expect(getMeta(withCurrency, "currency")).toBe("CNY");
    expect(getMeta(undefined, "currency")).toBe("");
  });

  it("visibleItemFields hides meta", () => {
    const it = item([fv("__currency", "USD"), fv("Color", "Red")]);
    expect(visibleItemFields(it).map((f) => f.label)).toEqual(["Color"]);
  });
});
