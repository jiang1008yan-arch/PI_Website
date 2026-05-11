import type { PiItem } from "../types";

export type PiSnapshot = { header: Record<string, any>; items: PiItem[] };

export type PiDiff = {
  header: Record<string, [unknown, unknown]>;
  items: {
    added: PiItem[];
    removed: PiItem[];
    modified: { id: string; changes: Record<string, [unknown, unknown]> }[];
  };
};

const IGNORE_HEADER_KEYS = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "createdById",
  "assignedToId",
  "seq",
  "archivedAt"
]);

const ITEM_NUMERIC_KEYS = ["quantity", "unitPrice", "discountPct"] as const;

export function computePiDiff(canonical: PiSnapshot, edited: PiSnapshot): PiDiff | null {
  const header: Record<string, [unknown, unknown]> = {};
  const keys = new Set([...Object.keys(canonical.header ?? {}), ...Object.keys(edited.header ?? {})]);
  for (const key of keys) {
    if (IGNORE_HEADER_KEYS.has(key)) continue;
    const before = canonical.header?.[key] ?? "";
    const after = edited.header?.[key] ?? "";
    if (String(before) !== String(after)) header[key] = [before, after];
  }

  const canonicalById = new Map(canonical.items.map((it: any) => [it.id, it]));
  const editedById = new Map(edited.items.filter((it: any) => it.id).map((it: any) => [it.id, it]));

  const added = edited.items.filter((it: any) => !it.id || !canonicalById.has(it.id));
  const removed = canonical.items.filter((it: any) => !editedById.has(it.id));
  const modified: { id: string; changes: Record<string, [unknown, unknown]> }[] = [];

  for (const editedItem of edited.items) {
    const itemId = (editedItem as any).id;
    if (!itemId) continue;
    const original = canonicalById.get(itemId) as any;
    if (!original) continue;
    const changes: Record<string, [unknown, unknown]> = {};
    for (const key of ITEM_NUMERIC_KEYS) {
      if (Number(original[key]) !== Number((editedItem as any)[key])) {
        changes[key] = [original[key], (editedItem as any)[key]];
      }
    }
    if (original.productId !== (editedItem as any).productId) {
      changes.productId = [original.productId, (editedItem as any).productId];
    }
    if (JSON.stringify(original.fieldValues) !== JSON.stringify((editedItem as any).fieldValues)) {
      changes.fieldValues = [original.fieldValues, (editedItem as any).fieldValues];
    }
    if (Object.keys(changes).length) modified.push({ id: itemId, changes });
  }

  const empty = Object.keys(header).length === 0 && !added.length && !removed.length && !modified.length;
  if (empty) return null;
  return { header, items: { added, removed, modified } };
}
