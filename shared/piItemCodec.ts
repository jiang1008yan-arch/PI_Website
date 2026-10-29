import type { FieldValue, PiItem } from "./lineItem";

// The one reader of a line item's `fieldValues`, for both bundles. Stored and
// sent as a JSON string (piItems rows, the submitted snapshot), but a frozen
// effective snapshot keeps it as an array — both read the same here, and
// anything unreadable is no fields. The codec preserves every other field on
// the row (id, sortOrder, joined product columns like code / nameEn / nameZh)
// — the result is typed as `PiItem & Record<string, any>` so callers that need
// extras (e.g. the Excel exporter reading `item.code`) keep access without
// re-declaring the shape.
export type WirePiItem = Record<string, any> & { fieldValues: string | unknown[] | null | undefined };
export type ParsedPiItem = PiItem & Record<string, any>;

export function parsePiItem(wire: WirePiItem): ParsedPiItem {
  return { ...wire, fieldValues: parseFieldValues(wire.fieldValues) } as ParsedPiItem;
}

export function parsePiItems(wires: WirePiItem[]): ParsedPiItem[] {
  return wires.map(parsePiItem);
}

export function parseFieldValues(raw: unknown): FieldValue[] {
  if (Array.isArray(raw)) return raw as FieldValue[];
  if (typeof raw !== "string" || raw === "") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FieldValue[]) : [];
  } catch {
    return [];
  }
}
