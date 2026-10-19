// Fault statistics: which catalog products keep showing the same confirmed
// fault type. Only after-sales-confirmed fault types count.

export type FaultCountRow = { productId: string | null; productName: string | null; faultType: string; n: number };

export type FaultMatrix = {
  faultTypes: string[];
  products: { productId: string | null; productName: string; total: number; byFault: Record<string, number> }[];
};

// Shapes GROUP BY (product, fault) counts into a product × fault matrix: fault
// columns ordered by overall frequency, product rows by their total.
export function buildFaultMatrix(rows: FaultCountRow[]): FaultMatrix {
  const faultTotals = new Map<string, number>();
  const byProduct = new Map<string, FaultMatrix["products"][number]>();
  for (const row of rows) {
    if (!row.faultType) continue;
    faultTotals.set(row.faultType, (faultTotals.get(row.faultType) ?? 0) + row.n);
    const key = row.productId ?? "";
    const entry = byProduct.get(key) ?? { productId: row.productId, productName: row.productName || "(no product)", total: 0, byFault: {} };
    entry.byFault[row.faultType] = (entry.byFault[row.faultType] ?? 0) + row.n;
    entry.total += row.n;
    byProduct.set(key, entry);
  }
  const faultTypes = [...faultTotals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([f]) => f);
  const products = [...byProduct.values()].sort((a, b) => b.total - a.total || a.productName.localeCompare(b.productName));
  return { faultTypes, products };
}

export const DEFAULT_REPEAT_WINDOW_DAYS = 90;
export const DEFAULT_REPEAT_THRESHOLD = 3;

export type RepeatSettings = { windowDays: number; threshold: number };

// Reads the two admin-configured numbers, falling back to the defaults for
// anything missing or not a positive integer.
export function repeatSettings(windowDays: unknown, threshold: unknown): RepeatSettings {
  const positive = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  return {
    windowDays: positive(windowDays, DEFAULT_REPEAT_WINDOW_DAYS),
    threshold: positive(threshold, DEFAULT_REPEAT_THRESHOLD)
  };
}

// Start of the look-back window, in SQLite's datetime text format.
export function repeatWindowStart(now: Date, windowDays: number): string {
  return new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
}

// A repeat fault: the same fault type on the same product reached the threshold
// within the window (the count includes the ticket being looked at).
export function isRepeatFault(count: number, settings: RepeatSettings): boolean {
  return count >= settings.threshold;
}
