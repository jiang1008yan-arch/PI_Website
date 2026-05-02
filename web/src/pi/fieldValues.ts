import type { PiItem } from "../types";

export function visibleFieldValues(item: PiItem) {
  return item.fieldValues.filter((field) => !field.label.startsWith("__"));
}

export function getMeta(item: PiItem | undefined, key: "currency") {
  return item?.fieldValues.find((field) => field.label === `__${key}`)?.value ?? "";
}

export function setMeta(item: PiItem, key: "currency", value: string): PiItem {
  const label = `__${key}`;
  const exists = item.fieldValues.some((field) => field.label === label);
  return {
    ...item,
    fieldValues: exists
      ? item.fieldValues.map((field) => (field.label === label ? { ...field, value } : field))
      : [...item.fieldValues, { label, value, fieldType: "TEXT", sortOrder: -1 }]
  };
}
