import type { Language, PiItem } from "../types";

export type ModelOption = { code: string; description: string };
export type ModelSegment = { id: string; label: string; options: ModelOption[] };
export type ModelRule = {
  enabled: boolean;
  prefix: string;
  prefixOptions: ModelOption[];
  separator: string;
  segments: ModelSegment[];
};

export type FieldValue = PiItem["fieldValues"][number];

export const blankRule = (): ModelRule => ({
  enabled: false,
  prefix: "",
  prefixOptions: [],
  separator: "-",
  segments: []
});

export function normalizeRule(rule: any, opts: { generateSegmentIds?: boolean } = {}): ModelRule {
  const segmentId = (raw: any) => {
    const id = String(raw ?? "");
    if (id) return id;
    return opts.generateSegmentIds ? crypto.randomUUID() : "";
  };
  return {
    enabled: Boolean(rule?.enabled),
    prefix: String(rule?.prefix ?? ""),
    prefixOptions: Array.isArray(rule?.prefixOptions)
      ? rule.prefixOptions
          .map((option: any) => ({
            code: String(option.code ?? ""),
            description: String(option.description ?? "")
          }))
          .filter((option: ModelOption) => option.code)
      : rule?.prefix
        ? [{ code: String(rule.prefix), description: "" }]
        : [],
    separator: String(rule?.separator ?? "-"),
    segments: Array.isArray(rule?.segments)
      ? rule.segments.map((segment: any) => ({
          id: segmentId(segment.id),
          label: String(segment.label ?? ""),
          options: Array.isArray(segment.options)
            ? segment.options
                .map((option: any) => ({
                  code: String(option.code ?? ""),
                  description: String(option.description ?? "")
                }))
                .filter((option: ModelOption) => option.code)
            : []
        }))
      : []
  };
}

export function modelLabel(language: Language) {
  return language === "ZH" ? "型号" : "Model";
}

export function orderMeaningLabel(language: Language) {
  return language === "ZH" ? "订货号释义" : "Order Code Meaning";
}

export function modelRuleKey(productId: string, language: Language) {
  return `productModelRule:${productId}:${language}`;
}

export function optionPath(key: string) {
  return `/options/${encodeURIComponent(key)}`;
}

export function getSegmentKey(segment: ModelSegment) {
  return `__modelSegment:${segment.id || segment.label}`;
}

export function getModelPrefix(item: PiItem, rule: ModelRule) {
  return (
    item.fieldValues.find((field) => field.label === "__modelPrefix")?.value ??
    rule.prefixOptions[0]?.code ??
    rule.prefix ??
    ""
  );
}

export function setModelPrefix(item: PiItem, value: string): PiItem {
  return upsertField(item, "__modelPrefix", value);
}

export function getSegmentValue(item: PiItem, segment: ModelSegment) {
  return item.fieldValues.find((field) => field.label === getSegmentKey(segment))?.value ?? "";
}

export function setSegmentValue(item: PiItem, segment: ModelSegment, value: string): PiItem {
  return upsertField(item, getSegmentKey(segment), value);
}

export function getModelRule(item: PiItem): ModelRule | null {
  const raw = item.fieldValues.find((field) => field.label === "__modelRule")?.value;
  if (!raw) return null;
  try {
    return normalizeRule(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function modelRuleSeedFields(rule: ModelRule, language: Language): FieldValue[] {
  return [
    { label: "__modelRule", value: JSON.stringify(rule), fieldType: "TEXT", sortOrder: -10 },
    {
      label: "__modelPrefix",
      value: rule.prefixOptions[0]?.code ?? rule.prefix ?? "",
      fieldType: "TEXT",
      sortOrder: -10
    },
    ...rule.segments.map((segment, index) => ({
      label: getSegmentKey(segment),
      value: "",
      fieldType: "TEXT",
      sortOrder: -9 + index
    })),
    { label: modelLabel(language), value: "", fieldType: "TEXT", sortOrder: -5 },
    { label: "Model Lines", value: "", fieldType: "TEXT", sortOrder: -4 },
    { label: orderMeaningLabel(language), value: "", fieldType: "TEXT", sortOrder: -3 }
  ];
}

export function buildGeneratedModel(rule: ModelRule, item: PiItem) {
  const prefix = getModelPrefix(item, rule);
  const selected = rule.segments.map((segment) => ({
    segment,
    code: getSegmentValue(item, segment),
    option: segment.options.find((option) => option.code === getSegmentValue(item, segment))
  }));
  const codes = selected.map((entry) => entry.code).join("");
  const model = [prefix, codes].filter(Boolean).join(rule.separator);
  const modelLines = [
    prefix,
    prefix && codes ? rule.separator : "",
    ...selected.map((entry) => entry.code).filter(Boolean)
  ]
    .filter((line) => line !== "")
    .join("\n");
  const meaning = selected
    .filter((entry) => entry.code)
    .map((entry) => `${entry.code}: ${entry.option?.description ?? ""}`)
    .join("\n");
  return { model, modelLines, meaning };
}

export function applyModelRule(item: PiItem, language: Language): PiItem {
  const rule = getModelRule(item);
  if (!rule) return item;
  const generated = buildGeneratedModel(rule, item);
  return upsertField(
    upsertField(upsertField(item, modelLabel(language), generated.model), "Model Lines", generated.modelLines),
    orderMeaningLabel(language),
    generated.meaning
  );
}

export function upsertField(item: PiItem, label: string, value: string): PiItem {
  const exists = item.fieldValues.some((field) => field.label === label);
  return {
    ...item,
    fieldValues: exists
      ? item.fieldValues.map((field) => (field.label === label ? { ...field, value } : field))
      : [...item.fieldValues, { label, value, fieldType: "TEXT", sortOrder: -1 }]
  };
}

export function isModelField(field: { label: string }) {
  const label = field.label.trim().toLowerCase();
  return label === "model" || label === "型号";
}

export function isOrderMeaningField(field: { label: string }) {
  const label = field.label.trim().toLowerCase();
  return label === "order code meaning" || label === "订货号释义";
}

export function isGeneratedModelField(field: { label: string }) {
  return (
    isModelField(field) ||
    isOrderMeaningField(field) ||
    field.label.trim().toLowerCase() === "model lines"
  );
}
