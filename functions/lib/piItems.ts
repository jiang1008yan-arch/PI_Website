import { id } from "./db";

// Sole owner of how a PI line item is written to the wire: the INSERT columns,
// the Number() coercion of the numeric fields, and the JSON encoding of
// fieldValues. Both the route handlers ([api/routes/pi.ts]) and the workflow
// runner ([lib/piWorkflow.ts]) compose these statements into their own batch —
// the workflow folds the replace into the same atomic batch as the pi UPDATE
// and the review event, so this module returns statements rather than executing.

export type PiItemInput = {
  productId: string;
  quantity: number | string;
  unitPrice: number | string;
  discountPct: number | string;
  fieldValues: unknown[];
};

const INSERT_SQL =
  "INSERT INTO piItems (id, piId, productId, quantity, unitPrice, discountPct, fieldValues, sortOrder) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";

export function piItemInsertStatements(
  db: D1Database,
  piId: string,
  items: PiItemInput[]
): D1PreparedStatement[] {
  if (!items.length) return [];
  const insert = db.prepare(INSERT_SQL);
  return items.map((it, i) =>
    insert.bind(
      id("itm"),
      piId,
      it.productId,
      Number(it.quantity ?? 1),
      Number(it.unitPrice ?? 0),
      Number(it.discountPct ?? 0),
      JSON.stringify(it.fieldValues ?? []),
      i
    )
  );
}

// Delete-then-insert: replaces a PI's line items wholesale. Always non-empty
// (it carries the DELETE even when items is empty), so callers can batch it
// directly without an emptiness guard.
export function piItemReplaceStatements(
  db: D1Database,
  piId: string,
  items: PiItemInput[]
): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM piItems WHERE piId=?").bind(piId),
    ...piItemInsertStatements(db, piId, items)
  ];
}
