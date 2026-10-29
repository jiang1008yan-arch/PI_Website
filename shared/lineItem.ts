// A PI line item, shared across both bundles: its shape and its amount. The
// wire encoding of `fieldValues` is piItemCodec's; what the fields mean is
// lineItemFields' and modelRule's (all in shared/).
//
// Types are structural, so each bundle's own values fit them.

export type Language = "EN" | "ZH";

export type FieldValue = {
  label: string;
  value: string;
  fieldType: string;
  options?: string[];
  sortOrder: number;
};

export type PiItem = {
  productId: string;
  quantity: number;
  unitPrice: number;
  discountPct: number;
  fieldValues: FieldValue[];
};

type Priced = { quantity: unknown; unitPrice: unknown; discountPct: unknown };

// quantity × unit price, less the discount (in percent). Numbers may arrive as
// strings from a form or the database.
export function lineAmount(item: Priced): number {
  return Number(item.quantity) * Number(item.unitPrice) * (1 - Number(item.discountPct) / 100);
}

export function itemsTotal(items: readonly Priced[]): number {
  return items.reduce((sum, item) => sum + lineAmount(item), 0);
}
