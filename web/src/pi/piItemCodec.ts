import type { FieldValue, PiItem } from "../types";

// Wire shape from the API: an object carrying at least a JSON-encoded
// `fieldValues` string. The codec parses `fieldValues` and preserves every
// other field on the row (id, sortOrder, joined product columns like code /
// nameEn / nameZh) — the result is typed as `PiItem & Record<string, any>` so
// callers that need extras (e.g. the Excel exporter reading `item.code`) keep
// access without re-declaring the shape.
export type WirePiItem = Record<string, any> & { fieldValues: string | null | undefined };
export type ParsedPiItem = PiItem & Record<string, any>;

export function parsePiItem(wire: WirePiItem): ParsedPiItem {
  return { ...wire, fieldValues: parseFieldValues(wire.fieldValues) } as ParsedPiItem;
}

export function parsePiItems(wires: WirePiItem[]): ParsedPiItem[] {
  return wires.map(parsePiItem);
}

function parseFieldValues(raw: string | null | undefined): FieldValue[] {
  if (raw == null || raw === "") return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? (parsed as FieldValue[]) : [];
}
