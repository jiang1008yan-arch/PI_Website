// Fault statistics: which products and models keep showing the same confirmed
// fault type. Only after-sales-confirmed fault types count.

export type FaultTicket = {
  id: string;
  ticketNo: string;
  customerCompany: string;
  createdAt: string;
  productId: string | null;
  productName: string | null;
  productModel: string | null;
  faultType: string;
};

// Confirmed faults per (catalog product, fault type) inside the repeat window.
export type ProductFaultCount = { productId: string | null; faultType: string; n: number };

export type FaultRankingRow = {
  productId: string | null;
  productName: string;
  productModel: string | null;
  faultType: string;
  n: number;
  lastAt: string;
  // Same product and fault within the repeat window, across all its models —
  // repeat faults are judged per product.
  productTotal: number;
  isRepeat: boolean;
  tickets: Pick<FaultTicket, "id" | "ticketNo" | "customerCompany" | "createdAt">[];
};

// One row per product · model · fault type, most frequent first, then most
// recent. A row is a repeat fault when its product has reached the threshold
// for that fault within the window, whichever models the tickets were on.
export function buildFaultRanking(tickets: FaultTicket[], windowCounts: ProductFaultCount[], settings: RepeatSettings): FaultRankingRow[] {
  const productTotals = new Map(windowCounts.map((c) => [JSON.stringify([c.productId, c.faultType]), c.n]));
  const rows = new Map<string, FaultRankingRow>();
  for (const t of tickets) {
    if (!t.faultType) continue;
    const model = t.productModel?.trim() || null;
    const key = JSON.stringify([t.productId, model, t.faultType]);
    let row = rows.get(key);
    if (!row) {
      const productTotal = productTotals.get(JSON.stringify([t.productId, t.faultType])) ?? 0;
      row = {
        productId: t.productId,
        productName: t.productName || "(no product)",
        productModel: model,
        faultType: t.faultType,
        n: 0,
        lastAt: t.createdAt,
        productTotal,
        isRepeat: t.productId !== null && isRepeatFault(productTotal, settings),
        tickets: []
      };
      rows.set(key, row);
    }
    row.n += 1;
    if (t.createdAt > row.lastAt) row.lastAt = t.createdAt;
    row.tickets.push({ id: t.id, ticketNo: t.ticketNo, customerCompany: t.customerCompany, createdAt: t.createdAt });
  }
  for (const row of rows.values()) row.tickets.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return [...rows.values()].sort(
    (a, b) => b.n - a.n || b.lastAt.localeCompare(a.lastAt) || a.productName.localeCompare(b.productName) || (a.productModel ?? "").localeCompare(b.productModel ?? "")
  );
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

export async function loadRepeatSettings(db: D1Database): Promise<RepeatSettings> {
  const rows = (
    await db.prepare("SELECT optionKey, value FROM appOptions WHERE optionKey IN ('repeatFaultDays', 'repeatFaultThreshold')").all<{ optionKey: string; value: string }>()
  ).results ?? [];
  const get = (key: string) => rows.find((r) => r.optionKey === key)?.value;
  return repeatSettings(get("repeatFaultDays"), get("repeatFaultThreshold"));
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

// How often this product has had this confirmed fault within the window.
export async function repeatInfo(db: D1Database, productId: string | null, faultType: string | null, now: Date) {
  if (!productId || !faultType) return null;
  const settings = await loadRepeatSettings(db);
  const since = repeatWindowStart(now, settings.windowDays);
  const tickets =
    (
      await db
        .prepare(
          `SELECT id, ticketNo, createdAt, customerCompany, productModel, assignedSalesId FROM tickets
           WHERE productId = ? AND faultType = ? AND createdAt >= ? ORDER BY createdAt DESC`
        )
        .bind(productId, faultType, since)
        .all<{ id: string; ticketNo: string; createdAt: string; customerCompany: string; productModel: string | null; assignedSalesId: string | null }>()
    ).results ?? [];
  return { count: tickets.length, windowDays: settings.windowDays, threshold: settings.threshold, isRepeat: isRepeatFault(tickets.length, settings), tickets };
}
