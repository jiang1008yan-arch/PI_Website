import { all, first } from "./db";
import { parseEffectiveSnapshot, type EffectiveSnapshot } from "./piWorkflow";

// The effective version of a PI (docs/adr/0001-revision-via-effective-snapshot.md):
// what was last approved. While a revision of an approved ZH PI is in progress
// the live rows are being edited, and the approved ZH + linked EN content is the
// snapshot frozen on the ZH row. Every reader of approved PIs goes through here
// (CONTEXT.md "Effective version"); piWorkflow writes the snapshot.

// SQL: the ZH PIs with an effective version, i.e. approved, or approved and now
// being revised.
export const EFFECTIVE_ZH = (alias = "pi") => `(${alias}.language = 'ZH' AND (${alias}.status = 'APPROVED' OR ${alias}.revisionInProgress = 1))`;

export type EffectiveHeaderColumn = "productionOrderNo" | "customerCompany";

// SQL: a header value of the effective version, trimmed, '' when there is none.
export const effectiveHeader = (column: EffectiveHeaderColumn, alias = "pi") =>
  `TRIM(COALESCE(json_extract(${alias}.effectiveSnapshot, '$.zh.header.${column}'), ${alias}.${column}, ''))`;

type PiLike = { language: string; linkedPiId?: string | null; revisionInProgress?: number | boolean | null; effectiveSnapshot?: string | null };

// The effective content of a PI (ZH, or EN through its linked ZH PI) when it
// differs from the live rows, i.e. while a revision is in progress: the row with
// the frozen header over it, and the frozen items with product names like
// piItems rows. null otherwise: the live rows are the effective version.
// For an EN PI, pass its ZH PI when it is already loaded.
export async function readEffective<R extends PiLike>(db: D1Database, row: R, zh?: PiLike) {
  const zhRow =
    row.language === "ZH"
      ? row
      : (zh ??
        (row.linkedPiId
          ? await first<PiLike>(db, "SELECT language, revisionInProgress, effectiveSnapshot FROM pi WHERE id=?", row.linkedPiId)
          : null));
  if (!zhRow?.revisionInProgress) return null;
  const snapshot = parseEffectiveSnapshot(zhRow.effectiveSnapshot);
  const part = row.language === "ZH" ? snapshot?.zh : snapshot?.en;
  if (!part) return null;
  return { pi: { ...row, ...part.header } as R & Record<string, unknown>, items: await itemsWithProducts(db, part.items) };
}

// Frozen items, decorated with product names and positions like piItems rows.
async function itemsWithProducts(db: D1Database, items: EffectiveSnapshot["zh"]["items"]) {
  const ids = Array.from(new Set(items.map((it) => it.productId)));
  const products = ids.length
    ? await all<{ id: string; code: string; nameEn: string; nameZh: string }>(
        db,
        `SELECT id, code, nameEn, nameZh FROM products WHERE id IN (${ids.map(() => "?").join(", ")})`,
        ...ids
      )
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));
  return items.map((it, i) => ({
    ...it,
    fieldValues: JSON.stringify(it.fieldValues ?? []),
    sortOrder: i,
    code: byId.get(it.productId)?.code ?? null,
    nameEn: byId.get(it.productId)?.nameEn ?? null,
    nameZh: byId.get(it.productId)?.nameZh ?? null
  }));
}
