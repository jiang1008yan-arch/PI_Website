import type { Language, Product, ProductField } from "../types";

export const blankProduct = { nameEn: "", nameZh: "", status: "ACTIVE" };

export const blankField = (language: Language): ProductField => ({
  language,
  label: "",
  fieldType: "TEXT",
  options: [],
  defaultValue: "",
  sortOrder: 0,
  mapKey: null
});

export function parseField(field: any): ProductField {
  return { ...field, options: JSON.parse(field.options || "[]") };
}

export function normalizeField(field: any, language: Language): ProductField {
  return {
    ...field,
    id: field.id?.startsWith("draft-") ? undefined : field.id,
    language,
    label: String(field.label ?? "").trim(),
    fieldType: field.fieldType === "DROPDOWN" ? "DROPDOWN" : "TEXT",
    options: Array.isArray(field.options)
      ? field.options.map((item: unknown) => String(item).trim()).filter(Boolean)
      : [],
    defaultValue: field.defaultValue ?? "",
    sortOrder: Number(field.sortOrder ?? 0),
    mapKey: language === "ZH" && field.mapKey ? String(field.mapKey) : null
  };
}

export function resequence(fields: ProductField[]) {
  return fields.map((field, index) => ({ ...field, sortOrder: index }));
}

export function productPayload(product: any, selected?: Product | null) {
  return {
    ...product,
    code:
      selected?.code ??
      product.code ??
      `product-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  };
}

export function sameField(a: any, b: any) {
  const normalizeOptions = (options: unknown) =>
    JSON.stringify(
      Array.isArray(options)
        ? options.map((item: unknown) => String(item).trim()).filter(Boolean)
        : []
    );
  const normalizeType = (value: unknown) => (value === "DROPDOWN" ? "DROPDOWN" : "TEXT");
  const normalizeMapKey = (value: unknown) => (value ? String(value) : "");
  return (
    String(a.label ?? "").trim() === String(b.label ?? "").trim() &&
    normalizeType(a.fieldType) === normalizeType(b.fieldType) &&
    String(a.defaultValue ?? "") === String(b.defaultValue ?? "") &&
    normalizeOptions(a.options) === normalizeOptions(b.options) &&
    normalizeMapKey(a.mapKey) === normalizeMapKey(b.mapKey)
  );
}

export function optionSummary(options: string[], _defaultValue: string) {
  const count = options.length;
  if (!count) return "Set options (0)";
  return `Set options (${count})`;
}
