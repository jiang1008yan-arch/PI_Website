import { all } from "./db";

// 需求1 — one-time EN->ZH line-item seeding.
//
// Given the English PI's items, build the Chinese draft's items so the
// salesperson only reviews and tweaks. Per item:
//   - productId/quantity/unitPrice/discountPct are copied 1:1.
//   - fieldValues start from the ZH productFields defaults, then for each ZH
//     field carrying a mapKey (= the linked EN field's id) we pull the value
//     from the EN item: TEXT verbatim, DROPDOWN by option *position* (EN picked
//     the Nth option -> ZH gets its Nth option; out of range -> ZH default).
//   - ZH fields without a mapKey keep their default.

type FieldValue = {
  label: string;
  value: string;
  fieldType: string;
  options?: string[];
  sortOrder: number;
};

type EnItem = {
  productId: string;
  quantity?: unknown;
  unitPrice?: unknown;
  discountPct?: unknown;
  fieldValues?: FieldValue[];
};

type ZhFieldRow = {
  label: string;
  fieldType: string;
  options: string | null;
  defaultValue: string | null;
  sortOrder: number;
  mapKey: string | null;
};

type EnFieldRow = { id: string; label: string };

function parseOptions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function buildLinkedZhItems(db: D1Database, enItems: EnItem[]): Promise<any[]> {
  // Cache productFields lookups so repeated products don't re-query.
  const zhFieldsCache = new Map<string, ZhFieldRow[]>();
  const enFieldsCache = new Map<string, Map<string, string>>(); // productId -> (enFieldId -> label)

  const zhItems: any[] = [];
  for (const enItem of enItems) {
    const productId = enItem.productId;
    if (!zhFieldsCache.has(productId)) {
      zhFieldsCache.set(
        productId,
        await all<ZhFieldRow>(
          db,
          "SELECT label, fieldType, options, defaultValue, sortOrder, mapKey FROM productFields WHERE productId=? AND language='ZH' ORDER BY sortOrder, label",
          productId
        )
      );
    }
    if (!enFieldsCache.has(productId)) {
      const rows = await all<EnFieldRow>(
        db,
        "SELECT id, label FROM productFields WHERE productId=? AND language='EN'",
        productId
      );
      enFieldsCache.set(productId, new Map(rows.map((r) => [r.id, r.label])));
    }

    const zhFields = zhFieldsCache.get(productId)!;
    const enFieldLabelById = enFieldsCache.get(productId)!;
    const enValuesByLabel = new Map<string, FieldValue>(
      (enItem.fieldValues ?? []).map((fv) => [fv.label, fv])
    );

    const fieldValues: FieldValue[] = zhFields.map((zf) => {
      const zhOptions = parseOptions(zf.options);
      let value = zf.defaultValue ?? "";
      if (zf.mapKey) {
        const enLabel = enFieldLabelById.get(zf.mapKey);
        const ev = enLabel != null ? enValuesByLabel.get(enLabel) : undefined;
        if (ev) {
          if (zf.fieldType === "DROPDOWN") {
            const n = (ev.options ?? []).indexOf(ev.value);
            if (n >= 0 && n < zhOptions.length) value = zhOptions[n];
          } else {
            value = ev.value;
          }
        }
      }
      return {
        label: zf.label,
        value,
        fieldType: zf.fieldType,
        options: zhOptions,
        sortOrder: zf.sortOrder
      };
    });

    zhItems.push({
      productId,
      quantity: Number(enItem.quantity ?? 1),
      unitPrice: Number(enItem.unitPrice ?? 0),
      discountPct: Number(enItem.discountPct ?? 0),
      fieldValues
    });
  }
  return zhItems;
}
