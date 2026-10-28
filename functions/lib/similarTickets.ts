import { all } from "./db";
import { loadRepeatSettings, repeatWindowStart } from "./faultStats";
import { normalizeSerial } from "./devices";

// "Has this happened before?" — earlier tickets shown before a new one is
// created, in the Feishu form and on the portal's New ticket page
// (docs/plans/2026-10-27-feishu-collect-and-similar-tickets.md). Four layers,
// strongest first; a ticket appears only in the strongest layer it matches:
// 1. the same device (SN) — an open one may mean this is a duplicate;
// 2. the same production order;
// 3. the same customer (names compared loosely) — open ones, and the rest
//    within the repeat window;
// 4. the same fault type (on the same product when it is known) within the
//    repeat window.

export type SimilarLayerKey = "SN" | "ORDER" | "CUSTOMER" | "FAULT";

export type SimilarTicket = {
  id: string;
  ticketNo: string;
  createdAt: string;
  customerCompany: string;
  status: string;
  summary: string | null;
};

export type SimilarLayer = { key: SimilarLayerKey; value: string; total: number; tickets: SimilarTicket[]; openDuplicate: boolean };

export type SimilarQuery = {
  serialNumber?: string | null;
  orderNo?: string | null;
  customerCompany?: string | null;
  productId?: string | null;
  faultType?: string | null;
  excludeTicketId?: string | null;
};

export const SIMILAR_PER_LAYER = 3;
const OPEN_STATUSES = new Set(["NEW", "IN_PROGRESS"]);

// Company forms and punctuation that differ between how people write the same
// customer ("ACME Co., Ltd." / "acme"; "深圳某某科技有限公司" / "深圳某某科技").
const COMPANY_SUFFIXES = [
  "股份有限公司", "有限责任公司", "有限公司", "公司",
  "co ltd", "company limited", "limited", "ltd", "inc", "incorporated", "corp", "corporation", "company", "co",
  "gmbh", "ag", "sl", "sa", "sas", "sarl", "srl", "spa", "bv", "nv", "llc", "plc", "pty", "oy", "ab", "as", "kg"
];

export function normalizeCustomer(name: string | null | undefined): string {
  let value = String(name ?? "").toLowerCase().normalize("NFKC");
  // Dots join ("S.L." → "sl"); other punctuation separates.
  value = value.replace(/[.。']/g, "").replace(/[()（）[\]【】,，&’"“”·\-_/\\]+/g, " ").replace(/\s+/g, " ").trim();
  // Strip trailing company forms, repeatedly ("acme gmbh co kg").
  for (let changed = true; changed && value; ) {
    changed = false;
    for (const suffix of COMPANY_SUFFIXES) {
      if (value === suffix) continue;
      if (value.endsWith(` ${suffix}`) || (/[^\x00-\x7f]$/.test(suffix) && value.endsWith(suffix) && value.length > suffix.length)) {
        value = value.slice(0, value.length - suffix.length).trim();
        changed = true;
      }
    }
  }
  return value.replace(/\s+/g, "");
}

// Assembles the layers from each layer's matches (newest first): drops tickets
// already shown in a stronger layer and keeps the first few of each.
export function assembleLayers(matches: { key: SimilarLayerKey; value: string; rows: SimilarTicket[] }[], excludeTicketId?: string | null): SimilarLayer[] {
  const seen = new Set<string>(excludeTicketId ? [excludeTicketId] : []);
  const layers: SimilarLayer[] = [];
  for (const m of matches) {
    const rows = m.rows.filter((t) => !seen.has(t.id));
    for (const t of rows) seen.add(t.id);
    if (!rows.length) continue;
    layers.push({
      key: m.key,
      value: m.value,
      total: rows.length,
      tickets: rows.slice(0, SIMILAR_PER_LAYER),
      openDuplicate: m.key === "SN" && rows.some((t) => OPEN_STATUSES.has(t.status))
    });
  }
  return layers;
}

// The first thing anyone wrote about it, when no one-line summary was set.
const COLUMNS = `t.id, t.ticketNo, t.createdAt, t.customerCompany, t.status,
  COALESCE(NULLIF(TRIM(t.summary), ''),
    (SELECT REPLACE(u.note, 'From Feishu: ', '') FROM ticketUpdates u WHERE u.ticketId = t.id AND u.kind = 'NOTE' AND u.isSystem = 0 AND u.note <> ''
     ORDER BY u.createdAt, u.rowid LIMIT 1)) AS summary`;
const CAP = 50;

export async function findSimilarTickets(db: D1Database, q: SimilarQuery, now: Date): Promise<{ layers: SimilarLayer[]; windowDays: number }> {
  const { windowDays } = await loadRepeatSettings(db);
  const since = repeatWindowStart(now, windowDays);
  const serial = normalizeSerial(q.serialNumber);
  const orderNo = String(q.orderNo ?? "").trim();
  const customer = normalizeCustomer(q.customerCompany);
  const faultType = String(q.faultType ?? "").trim();
  const productId = q.productId || null;
  const clip = (rows: SimilarTicket[]) => rows.map((r) => ({ ...r, summary: r.summary ? r.summary.slice(0, 200) : null }));

  const [bySerial, byOrder, customerCandidates, byFault] = await Promise.all([
    serial ? all<SimilarTicket>(db, `SELECT ${COLUMNS} FROM tickets t WHERE t.serialNumber = ? ORDER BY t.createdAt DESC LIMIT ${CAP}`, serial) : [],
    orderNo
      ? all<SimilarTicket>(db, `SELECT ${COLUMNS} FROM tickets t WHERE UPPER(TRIM(t.orderNo)) = UPPER(?) ORDER BY t.createdAt DESC LIMIT ${CAP}`, orderNo)
      : [],
    customer
      ? all<SimilarTicket>(
          db,
          `SELECT ${COLUMNS} FROM tickets t WHERE TRIM(t.customerCompany) <> '' AND (t.status IN ('NEW', 'IN_PROGRESS') OR t.createdAt >= ?)
           ORDER BY t.createdAt DESC LIMIT 2000`,
          since
        )
      : [],
    faultType
      ? all<SimilarTicket>(
          db,
          `SELECT ${COLUMNS} FROM tickets t WHERE t.faultType = ? AND t.createdAt >= ?${productId ? " AND t.productId = ?" : ""}
           ORDER BY t.createdAt DESC LIMIT ${CAP}`,
          ...[faultType, since, ...(productId ? [productId] : [])]
        )
      : []
  ]);
  const byCustomer = customerCandidates.filter((t) => normalizeCustomer(t.customerCompany) === customer).slice(0, CAP);
  return {
    windowDays,
    layers: assembleLayers(
      [
        { key: "SN", value: serial, rows: clip(bySerial) },
        { key: "ORDER", value: orderNo, rows: clip(byOrder) },
        { key: "CUSTOMER", value: String(q.customerCompany ?? "").trim(), rows: clip(byCustomer) },
        { key: "FAULT", value: faultType, rows: clip(byFault) }
      ],
      q.excludeTicketId
    )
  };
}
