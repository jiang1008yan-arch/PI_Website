import { describe, expect, it } from "vitest";
import type { PiItem } from "../types";
import {
  applyModelRule,
  blankRule,
  buildGeneratedModel,
  generatedModelFor,
  getModelPrefix,
  getModelRule,
  getSegmentKey,
  getSegmentValue,
  isGeneratedModelField,
  isModelField,
  isOrderMeaningField,
  modelLabel,
  modelRuleKey,
  modelRuleSeedFields,
  type ModelRule,
  normalizeRule,
  optionPath,
  orderMeaningLabel,
  setModelPrefix,
  setSegmentValue,
  upsertField
} from "./modelRule";

const baseItem = (overrides: Partial<PiItem> = {}): PiItem => ({
  productId: "p1",
  quantity: 1,
  unitPrice: 0,
  discountPct: 0,
  fieldValues: [],
  ...overrides
});

const ruleAB: ModelRule = {
  enabled: true,
  prefix: "",
  prefixOptions: [
    { code: "ABC", description: "Alpha series" },
    { code: "XYZ", description: "Xerion series" }
  ],
  separator: "-",
  segments: [
    {
      id: "size",
      label: "Size",
      options: [
        { code: "S", description: "Small" },
        { code: "L", description: "Large" }
      ]
    },
    {
      id: "color",
      label: "Color",
      options: [
        { code: "R", description: "Red" },
        { code: "B", description: "Blue" }
      ]
    }
  ]
};

const seededItem = (rule: ModelRule, fieldOverrides: { [label: string]: string } = {}): PiItem => {
  const base = baseItem({ fieldValues: modelRuleSeedFields(rule, "EN") });
  return Object.entries(fieldOverrides).reduce<PiItem>(
    (acc, [label, value]) => upsertField(acc, label, value),
    base
  );
};

describe("blankRule", () => {
  it("returns a disabled rule with empty defaults", () => {
    expect(blankRule()).toEqual({
      enabled: false,
      prefix: "",
      prefixOptions: [],
      separator: "-",
      segments: []
    });
  });
});

describe("normalizeRule", () => {
  it("returns a normalized blank shape for null/undefined input", () => {
    expect(normalizeRule(null)).toEqual({
      enabled: false,
      prefix: "",
      prefixOptions: [],
      separator: "-",
      segments: []
    });
    expect(normalizeRule(undefined)).toEqual(normalizeRule(null));
  });

  it("coerces enabled to boolean", () => {
    expect(normalizeRule({ enabled: 1 }).enabled).toBe(true);
    expect(normalizeRule({ enabled: 0 }).enabled).toBe(false);
    expect(normalizeRule({ enabled: "yes" }).enabled).toBe(true);
  });

  it("backfills prefixOptions from prefix when prefixOptions absent", () => {
    const rule = normalizeRule({ prefix: "ABC" });
    expect(rule.prefixOptions).toEqual([{ code: "ABC", description: "" }]);
  });

  it("does not backfill prefixOptions when an explicit list is provided", () => {
    const rule = normalizeRule({
      prefix: "ABC",
      prefixOptions: [{ code: "XYZ", description: "X" }]
    });
    expect(rule.prefixOptions).toEqual([{ code: "XYZ", description: "X" }]);
  });

  it("filters out prefixOptions and segment options with empty code", () => {
    const rule = normalizeRule({
      prefixOptions: [
        { code: "A", description: "ok" },
        { code: "", description: "drop me" },
        { description: "no code" }
      ],
      segments: [
        {
          id: "s1",
          label: "S",
          options: [
            { code: "X", description: "" },
            { code: "", description: "drop" }
          ]
        }
      ]
    });
    expect(rule.prefixOptions.map((o) => o.code)).toEqual(["A"]);
    expect(rule.segments[0].options.map((o) => o.code)).toEqual(["X"]);
  });

  it("defaults separator to '-' when missing, preserves a custom one", () => {
    expect(normalizeRule({}).separator).toBe("-");
    expect(normalizeRule({ separator: "/" }).separator).toBe("/");
  });

  it("preserves provided segment id and generates one only when asked", () => {
    expect(normalizeRule({ segments: [{ id: "keep-me", label: "L", options: [] }] })
      .segments[0].id).toBe("keep-me");
    expect(normalizeRule({ segments: [{ label: "L", options: [] }] })
      .segments[0].id).toBe("");
    const generated = normalizeRule({ segments: [{ label: "L", options: [] }] }, { generateSegmentIds: true });
    expect(generated.segments[0].id).toMatch(/^[0-9a-f-]+$/i);
  });

  it("returns empty arrays for non-array segments/prefixOptions input", () => {
    const rule = normalizeRule({ prefixOptions: "nope", segments: 42 });
    expect(rule.prefixOptions).toEqual([]);
    expect(rule.segments).toEqual([]);
  });
});

describe("label helpers", () => {
  it("modelLabel switches by language", () => {
    expect(modelLabel("EN")).toBe("Model");
    expect(modelLabel("ZH")).toBe("型号");
  });

  it("orderMeaningLabel switches by language", () => {
    expect(orderMeaningLabel("EN")).toBe("Order Code Meaning");
    expect(orderMeaningLabel("ZH")).toBe("订货号释义");
  });

  it("modelRuleKey encodes product + language", () => {
    expect(modelRuleKey("prod1", "EN")).toBe("productModelRule:prod1:EN");
    expect(modelRuleKey("prod1", "ZH")).toBe("productModelRule:prod1:ZH");
  });

  it("optionPath URL-encodes the key", () => {
    expect(optionPath("a:b")).toBe("/options/a%3Ab");
  });

  it("getSegmentKey prefers id, falls back to label", () => {
    expect(getSegmentKey({ id: "size", label: "Size", options: [] })).toBe("__modelSegment:size");
    expect(getSegmentKey({ id: "", label: "Size", options: [] })).toBe("__modelSegment:Size");
  });
});

describe("getModelPrefix fallback chain", () => {
  it("returns the item's __modelPrefix when set", () => {
    const item = upsertField(baseItem(), "__modelPrefix", "ZZZ");
    expect(getModelPrefix(item, ruleAB)).toBe("ZZZ");
  });

  it("falls back to first prefixOption when item has none", () => {
    expect(getModelPrefix(baseItem(), ruleAB)).toBe("ABC");
  });

  it("falls back to rule.prefix when no prefixOptions", () => {
    const rule = { ...ruleAB, prefixOptions: [], prefix: "FALLBACK" };
    expect(getModelPrefix(baseItem(), rule)).toBe("FALLBACK");
  });

  it("returns empty string when nothing is set", () => {
    const rule = { ...ruleAB, prefixOptions: [], prefix: "" };
    expect(getModelPrefix(baseItem(), rule)).toBe("");
  });
});

describe("setModelPrefix / setSegmentValue / getSegmentValue", () => {
  it("setModelPrefix upserts the meta field", () => {
    const item = setModelPrefix(baseItem(), "XYZ");
    expect(getModelPrefix(item, ruleAB)).toBe("XYZ");
  });

  it("setSegmentValue stores under the segment key", () => {
    const segment = ruleAB.segments[0];
    const item = setSegmentValue(baseItem(), segment, "S");
    expect(getSegmentValue(item, segment)).toBe("S");
  });

  it("setSegmentValue overwrites an existing value rather than appending", () => {
    const segment = ruleAB.segments[0];
    let item = setSegmentValue(baseItem(), segment, "S");
    item = setSegmentValue(item, segment, "L");
    expect(getSegmentValue(item, segment)).toBe("L");
    expect(item.fieldValues.filter((f) => f.label === getSegmentKey(segment))).toHaveLength(1);
  });
});

describe("getModelRule", () => {
  it("returns the parsed rule when __modelRule is valid JSON", () => {
    const item = upsertField(baseItem(), "__modelRule", JSON.stringify(ruleAB));
    expect(getModelRule(item)?.prefixOptions[0].code).toBe("ABC");
  });

  it("returns null when __modelRule is missing", () => {
    expect(getModelRule(baseItem())).toBeNull();
  });

  it("returns null on malformed JSON instead of throwing", () => {
    const item = upsertField(baseItem(), "__modelRule", "{not json");
    expect(getModelRule(item)).toBeNull();
  });
});

describe("modelRuleSeedFields", () => {
  it("seeds meta + per-segment placeholder + Model / Model Lines / Order Code Meaning", () => {
    const fields = modelRuleSeedFields(ruleAB, "EN");
    const labels = fields.map((f) => f.label);
    expect(labels).toContain("__modelRule");
    expect(labels).toContain("__modelPrefix");
    expect(labels).toContain(getSegmentKey(ruleAB.segments[0]));
    expect(labels).toContain(getSegmentKey(ruleAB.segments[1]));
    expect(labels).toContain("Model");
    expect(labels).toContain("Model Lines");
    expect(labels).toContain("Order Code Meaning");
  });

  it("uses the localized model and meaning labels for ZH", () => {
    const labels = modelRuleSeedFields(ruleAB, "ZH").map((f) => f.label);
    expect(labels).toContain("型号");
    expect(labels).toContain("订货号释义");
    expect(labels).not.toContain("Model");
  });

  it("seeds __modelPrefix with the first prefixOption code", () => {
    const fields = modelRuleSeedFields(ruleAB, "EN");
    expect(fields.find((f) => f.label === "__modelPrefix")?.value).toBe("ABC");
  });
});

describe("buildGeneratedModel — the core engine", () => {
  it("joins prefix and concatenated segment codes with the separator", () => {
    const item = seededItem(ruleAB, {
      [getSegmentKey(ruleAB.segments[0])]: "S",
      [getSegmentKey(ruleAB.segments[1])]: "R"
    });
    const out = buildGeneratedModel(ruleAB, item);
    expect(out.model).toBe("ABC-SR");
  });

  it("returns prefix-only when no segments are selected", () => {
    const item = seededItem(ruleAB);
    expect(buildGeneratedModel(ruleAB, item).model).toBe("ABC");
  });

  it("returns codes-only when prefix is empty", () => {
    const noPrefixRule = { ...ruleAB, prefixOptions: [], prefix: "" };
    const item = seededItem(noPrefixRule, {
      [getSegmentKey(noPrefixRule.segments[0])]: "L",
      [getSegmentKey(noPrefixRule.segments[1])]: "B"
    });
    const out = buildGeneratedModel(noPrefixRule, item);
    expect(out.model).toBe("LB");
  });

  it("returns empty model when nothing is set", () => {
    const noPrefixRule = { ...ruleAB, prefixOptions: [], prefix: "" };
    const item = baseItem();
    expect(buildGeneratedModel(noPrefixRule, item).model).toBe("");
  });

  it("respects a custom separator", () => {
    const slashRule = { ...ruleAB, separator: "/" };
    const item = seededItem(slashRule, {
      [getSegmentKey(slashRule.segments[0])]: "S",
      [getSegmentKey(slashRule.segments[1])]: "R"
    });
    expect(buildGeneratedModel(slashRule, item).model).toBe("ABC/SR");
  });

  it("modelLines puts prefix on a line, then the separator, then each code", () => {
    const item = seededItem(ruleAB, {
      [getSegmentKey(ruleAB.segments[0])]: "S",
      [getSegmentKey(ruleAB.segments[1])]: "R"
    });
    expect(buildGeneratedModel(ruleAB, item).modelLines).toBe("ABC\n-\nS\nR");
  });

  it("meaning lists only selected codes with their descriptions", () => {
    const item = seededItem(ruleAB, {
      [getSegmentKey(ruleAB.segments[0])]: "L"
      // second segment intentionally unselected
    });
    const out = buildGeneratedModel(ruleAB, item);
    expect(out.meaning).toBe("L: Large");
  });

  it("meaning leaves description empty when the selected code does not exist in segment options", () => {
    const item = seededItem(ruleAB, {
      [getSegmentKey(ruleAB.segments[0])]: "ZZZ"
    });
    expect(buildGeneratedModel(ruleAB, item).meaning).toBe("ZZZ: ");
  });
});

describe("applyModelRule", () => {
  it("returns the item unchanged when no rule is attached", () => {
    const item = baseItem();
    expect(applyModelRule(item, "EN")).toEqual(item);
  });

  it("populates Model, Model Lines, and Order Code Meaning on EN items", () => {
    const item = seededItem(ruleAB, {
      [getSegmentKey(ruleAB.segments[0])]: "S",
      [getSegmentKey(ruleAB.segments[1])]: "R"
    });
    const applied = applyModelRule(item, "EN");
    const field = (label: string) => applied.fieldValues.find((f) => f.label === label)?.value;
    expect(field("Model")).toBe("ABC-SR");
    expect(field("Model Lines")).toBe("ABC\n-\nS\nR");
    expect(field("Order Code Meaning")).toContain("S: Small");
    expect(field("Order Code Meaning")).toContain("R: Red");
  });

  it("populates the ZH localized labels on ZH items", () => {
    const item = seededItem(ruleAB, {
      [getSegmentKey(ruleAB.segments[0])]: "S"
    });
    const applied = applyModelRule(item, "ZH");
    const field = (label: string) => applied.fieldValues.find((f) => f.label === label)?.value;
    expect(field("型号")).toBe("ABC-S");
    expect(field("订货号释义")).toBe("S: Small");
  });

  it("overwrites previously generated values when inputs change", () => {
    let item = seededItem(ruleAB, {
      [getSegmentKey(ruleAB.segments[0])]: "S"
    });
    item = applyModelRule(item, "EN");
    item = setSegmentValue(item, ruleAB.segments[0], "L");
    item = applyModelRule(item, "EN");
    const model = item.fieldValues.find((f) => f.label === "Model")?.value;
    expect(model).toBe("ABC-L");
    // and only one Model field, not two
    expect(item.fieldValues.filter((f) => f.label === "Model")).toHaveLength(1);
  });
});

describe("upsertField", () => {
  it("appends a field that does not exist", () => {
    const item = upsertField(baseItem(), "New", "value");
    expect(item.fieldValues).toHaveLength(1);
    expect(item.fieldValues[0]).toEqual({ label: "New", value: "value", fieldType: "TEXT", sortOrder: -1 });
  });

  it("updates a field that already exists without duplicating", () => {
    let item = upsertField(baseItem(), "Color", "Red");
    item = upsertField(item, "Color", "Blue");
    expect(item.fieldValues).toHaveLength(1);
    expect(item.fieldValues[0].value).toBe("Blue");
  });

  it("preserves the rest of the array order on update", () => {
    let item = upsertField(baseItem(), "A", "1");
    item = upsertField(item, "B", "2");
    item = upsertField(item, "A", "1-changed");
    expect(item.fieldValues.map((f) => f.label)).toEqual(["A", "B"]);
  });
});

describe("generatedModelFor — the unified editor/export entry", () => {
  it("returns empties when the item carries no rule", () => {
    expect(generatedModelFor(baseItem())).toEqual({ model: "", modelLines: "", meaning: "" });
  });

  it("matches buildGeneratedModel for a seeded item", () => {
    const item = seededItem(ruleAB, { [getSegmentKey(ruleAB.segments[0])]: "S" });
    const rule = getModelRule(item)!;
    expect(generatedModelFor(item)).toEqual(buildGeneratedModel(rule, item));
  });

  // Regression: the Excel exporter used to fall back to prefixOptions[0] when
  // __modelPrefix was empty (|| ), diverging from the editor (?? ). The unified
  // path keeps an explicitly-empty prefix empty.
  it("keeps an explicitly empty __modelPrefix empty (no fallback to prefixOptions[0])", () => {
    const item = seededItem(ruleAB, {
      __modelPrefix: "",
      [getSegmentKey(ruleAB.segments[0])]: "S"
    });
    expect(generatedModelFor(item).model).toBe("S");
  });
});

describe("field-label predicates", () => {
  it("isModelField matches Model and 型号 case-insensitively, with trimming", () => {
    expect(isModelField({ label: "Model" })).toBe(true);
    expect(isModelField({ label: "  MODEL " })).toBe(true);
    expect(isModelField({ label: "型号" })).toBe(true);
    expect(isModelField({ label: "Other" })).toBe(false);
  });

  it("isOrderMeaningField matches both languages", () => {
    expect(isOrderMeaningField({ label: "Order Code Meaning" })).toBe(true);
    expect(isOrderMeaningField({ label: "订货号释义" })).toBe(true);
    expect(isOrderMeaningField({ label: "Model" })).toBe(false);
  });

  it("isGeneratedModelField covers Model, Order Code Meaning, and Model Lines", () => {
    expect(isGeneratedModelField({ label: "Model" })).toBe(true);
    expect(isGeneratedModelField({ label: "型号" })).toBe(true);
    expect(isGeneratedModelField({ label: "Order Code Meaning" })).toBe(true);
    expect(isGeneratedModelField({ label: "订货号释义" })).toBe(true);
    expect(isGeneratedModelField({ label: "Model Lines" })).toBe(true);
    expect(isGeneratedModelField({ label: "Color" })).toBe(false);
  });
});
