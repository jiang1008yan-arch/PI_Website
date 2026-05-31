import { all, first } from "./db";

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
type ModelOption = { code: string; description: string };
type ModelSegment = { id: string; label: string; options: ModelOption[] };
type ModelRule = {
  enabled: boolean;
  prefix: string;
  prefixOptions: ModelOption[];
  separator: string;
  segments: ModelSegment[];
};
type OptionRow = { value: string };

function parseOptions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function normalizeModelRule(rule: any): ModelRule {
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
          id: String(segment.id ?? ""),
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

function parseModelRule(raw: string | null | undefined): ModelRule | null {
  if (!raw) return null;
  try {
    const rule = normalizeModelRule(JSON.parse(raw));
    return rule.enabled ? rule : null;
  } catch {
    return null;
  }
}

function modelPrefix(rule: ModelRule) {
  return rule.prefixOptions[0]?.code ?? rule.prefix ?? "";
}

function modelSegmentKey(segment: ModelSegment) {
  return `__modelSegment:${segment.id || segment.label}`;
}

function seedZhModelRuleFields(rule: ModelRule): FieldValue[] {
  const prefix = modelPrefix(rule);
  return [
    { label: "__modelRule", value: JSON.stringify(rule), fieldType: "TEXT", sortOrder: -10 },
    { label: "__modelPrefix", value: prefix, fieldType: "TEXT", sortOrder: -10 },
    ...rule.segments.map((segment, index) => ({
      label: modelSegmentKey(segment),
      value: "",
      fieldType: "TEXT",
      sortOrder: -9 + index
    })),
    { label: "\u578b\u53f7", value: prefix, fieldType: "TEXT", sortOrder: -5 },
    { label: "Model Lines", value: prefix, fieldType: "TEXT", sortOrder: -4 },
    { label: "\u8ba2\u8d27\u53f7\u91ca\u4e49", value: "", fieldType: "TEXT", sortOrder: -3 }
  ];
}

async function loadZhModelRule(db: D1Database, productId: string): Promise<ModelRule | null> {
  const row = await first<OptionRow>(
    db,
    "SELECT value FROM appOptions WHERE optionKey=? ORDER BY sortOrder, value LIMIT 1",
    `productModelRule:${productId}:ZH`
  );
  return parseModelRule(row?.value);
}

export async function buildLinkedZhItems(db: D1Database, enItems: EnItem[]): Promise<any[]> {
  // Cache productFields lookups so repeated products don't re-query.
  const zhFieldsCache = new Map<string, ZhFieldRow[]>();
  const enFieldsCache = new Map<string, Map<string, string>>(); // productId -> (enFieldId -> label)
  const zhModelRuleCache = new Map<string, ModelRule | null>();

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
    if (!zhModelRuleCache.has(productId)) {
      zhModelRuleCache.set(productId, await loadZhModelRule(db, productId));
    }

    const zhFields = zhFieldsCache.get(productId)!;
    const enFieldLabelById = enFieldsCache.get(productId)!;
    const zhModelRule = zhModelRuleCache.get(productId);
    const enValuesByLabel = new Map<string, FieldValue>(
      (enItem.fieldValues ?? []).map((fv) => [fv.label, fv])
    );

    const mappedFieldValues: FieldValue[] = zhFields.map((zf) => {
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
    const modelRuleFields = zhModelRule ? seedZhModelRuleFields(zhModelRule) : [];

    zhItems.push({
      productId,
      quantity: Number(enItem.quantity ?? 1),
      unitPrice: Number(enItem.unitPrice ?? 0),
      discountPct: Number(enItem.discountPct ?? 0),
      fieldValues: [...modelRuleFields, ...mappedFieldValues]
    });
  }
  return zhItems;
}
