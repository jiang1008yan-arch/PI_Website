import type { FieldValue, PiItem } from "../types";

// Owner of the line-item field-set semantics: the `__`-prefixed meta-field
// convention, reading/writing fields by label, and splitting visible fields
// from hidden meta. The wire-parse seam (JSON string <-> FieldValue[]) stays in
// piItemCodec.ts; this module is the meaning seam that sits on top of it.
//
// Synthesized fields are stamped TEXT / sortOrder -1 so meta and injected model
// fields sort ahead of the product-defined fields.

const META_PREFIX = "__";

type LabelledValue = { label: string; value: string };

export function metaLabel(key: string): string {
  return META_PREFIX + key;
}

export function isMetaField(field: { label: string }): boolean {
  return field.label.startsWith(META_PREFIX);
}

// ── FieldValue[] core ────────────────────────────────────────────────────────

export function findFieldValue<T extends { label: string }>(
  fields: readonly T[],
  label: string
): T | undefined {
  return fields.find((field) => field.label === label);
}

export function visibleFieldValues<T extends { label: string }>(fields: readonly T[]): T[] {
  return fields.filter((field) => !isMetaField(field));
}

export function getMetaValue(fields: readonly LabelledValue[], key: string): string {
  return fields.find((field) => field.label === metaLabel(key))?.value ?? "";
}

export function upsertFieldValues(fields: FieldValue[], label: string, value: string): FieldValue[] {
  const exists = fields.some((field) => field.label === label);
  return exists
    ? fields.map((field) => (field.label === label ? { ...field, value } : field))
    : [...fields, { label, value, fieldType: "TEXT", sortOrder: -1 }];
}

export function setMetaValue(fields: FieldValue[], key: string, value: string): FieldValue[] {
  return upsertFieldValues(fields, metaLabel(key), value);
}

// ── PiItem wrappers ──────────────────────────────────────────────────────────
// Own the immutable `{ ...item, fieldValues }` spread once, so it stops being
// re-typed at every item-level call site.

export function upsertField(item: PiItem, label: string, value: string): PiItem {
  return { ...item, fieldValues: upsertFieldValues(item.fieldValues, label, value) };
}

export function setMeta(item: PiItem, key: string, value: string): PiItem {
  return { ...item, fieldValues: setMetaValue(item.fieldValues, key, value) };
}

export function getMeta(item: PiItem | undefined, key: string): string {
  return item ? getMetaValue(item.fieldValues, key) : "";
}

export function visibleItemFields(item: PiItem): FieldValue[] {
  return visibleFieldValues(item.fieldValues);
}
