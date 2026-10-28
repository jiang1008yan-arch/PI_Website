import { all } from "./db";
import { EFFECTIVE_ZH, effectiveHeader } from "./effectivePi";

// Type-ahead over data the system already has, so tickets reuse the exact
// production order numbers, customer names and SNs instead of free text:
// - production orders from approved Chinese PIs (their effective version);
// - customer names from approved PIs and earlier tickets;
// - device SNs registered on approved PIs.
// Used by GET /lookup (portal) and the Feishu ticket form.

export type OrderMatch = { productionOrderNo: string; customerCompany: string; piId: string; piNo: string; linkedPiNo: string | null };
export type CustomerMatch = { customerCompany: string; piCount: number; ticketCount: number };
export type DeviceMatch = { serialNumber: string; piId: string; piNo: string; productionOrderNo: string; customerCompany: string };
export type LookupResult = { orders: OrderMatch[]; customers: CustomerMatch[]; devices: DeviceMatch[] };
export type LookupKind = "all" | "order" | "customer" | "sn";

export const LOOKUP_MIN_CHARS = 2;
const LIMIT = 10;

// The effective (approved) version's header value, even during a revision.
const PO = effectiveHeader("productionOrderNo");
const CUSTOMER = effectiveHeader("customerCompany");
const APPROVED_ZH = EFFECTIVE_ZH();

const likeEscape = (text: string) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`);

export async function lookup(db: D1Database, rawQuery: string, kind: LookupKind = "all"): Promise<LookupResult> {
  const q = rawQuery.trim().toLowerCase().slice(0, 100);
  const empty: LookupResult = { orders: [], customers: [], devices: [] };
  if (q.length < LOOKUP_MIN_CHARS) return empty;
  const contains = `%${likeEscape(q)}%`;
  const prefix = `${likeEscape(q)}%`;
  const [orders, customers, devices] = await Promise.all([
    kind === "all" || kind === "order"
      ? all<OrderMatch>(
          db,
          `SELECT ${PO} AS productionOrderNo, ${CUSTOMER} AS customerCompany, pi.id AS piId, pi.piNo, linked.piNo AS linkedPiNo
           FROM pi LEFT JOIN pi linked ON linked.id = pi.linkedPiId
           WHERE ${APPROVED_ZH} AND ${PO} <> ''
             AND (LOWER(${PO}) LIKE ?1 ESCAPE '\\' OR LOWER(pi.piNo) LIKE ?1 ESCAPE '\\' OR LOWER(${CUSTOMER}) LIKE ?1 ESCAPE '\\')
           ORDER BY LOWER(${PO}) = ?3 DESC, LOWER(${PO}) LIKE ?2 ESCAPE '\\' DESC, pi.approvedAt DESC
           LIMIT ${LIMIT}`,
          contains,
          prefix,
          q
        )
      : [],
    kind === "all" || kind === "customer"
      ? all<CustomerMatch>(
          db,
          `SELECT MIN(name) AS customerCompany, SUM(fromPi) AS piCount, SUM(fromTicket) AS ticketCount FROM (
             SELECT ${CUSTOMER} AS name, 1 AS fromPi, 0 AS fromTicket FROM pi WHERE ${APPROVED_ZH}
             UNION ALL
             SELECT TRIM(customerCompany), 0, 1 FROM tickets
           )
           WHERE name <> '' AND LOWER(name) LIKE ?1 ESCAPE '\\'
           GROUP BY LOWER(name)
           ORDER BY LOWER(MIN(name)) LIKE ?2 ESCAPE '\\' DESC, SUM(fromPi) + SUM(fromTicket) DESC, MIN(name)
           LIMIT ${LIMIT}`,
          contains,
          prefix
        )
      : [],
    kind === "all" || kind === "sn"
      ? all<DeviceMatch>(
          db,
          `SELECT d.serialNumber, d.piId, pi.piNo, ${PO} AS productionOrderNo, ${CUSTOMER} AS customerCompany
           FROM devices d JOIN pi ON pi.id = d.piId
           WHERE LOWER(d.serialNumber) LIKE ?1 ESCAPE '\\'
           ORDER BY LOWER(d.serialNumber) LIKE ?2 ESCAPE '\\' DESC, d.serialNumber
           LIMIT ${LIMIT}`,
          contains,
          prefix
        )
      : []
  ]);
  return { orders, customers, devices };
}

// Lookup results as options for a picker (the Feishu form): value encodes what
// was picked, label shows enough to tell matches apart.
export function matchOptions(r: LookupResult, limit = 15): { value: string; label: string }[] {
  const piName = (m: { piNo: string; linkedPiNo?: string | null }) => (m.linkedPiNo ? `${m.piNo} / ${m.linkedPiNo}` : m.piNo);
  return [
    ...r.devices.map((m) => ({ value: `s:${m.serialNumber}`, label: `SN ${m.serialNumber} · ${m.productionOrderNo || "—"} · ${m.customerCompany || "—"}` })),
    ...r.orders.map((m) => ({ value: `o:${m.piId}`, label: `${m.productionOrderNo} · ${m.customerCompany || "—"} · ${piName(m)}` })),
    ...r.customers.map((m) => ({ value: `c:${m.customerCompany}`, label: `Customer: ${m.customerCompany}` }))
  ].slice(0, limit);
}

export type ResolvedMatch = { customerCompany?: string; orderNo?: string; serialNumber?: string };

// What a picked option fills in; null if it no longer exists.
export async function resolveMatch(db: D1Database, value: string): Promise<ResolvedMatch | null> {
  const [kind, ...rest] = value.split(":");
  const key = rest.join(":");
  if (!key) return null;
  if (kind === "c") return { customerCompany: key.slice(0, 200) };
  if (kind === "o") {
    const rows = await all<{ productionOrderNo: string; customerCompany: string }>(
      db,
      `SELECT ${PO} AS productionOrderNo, ${CUSTOMER} AS customerCompany FROM pi WHERE pi.id = ? AND ${APPROVED_ZH}`,
      key
    );
    return rows[0] ? { orderNo: rows[0].productionOrderNo, customerCompany: rows[0].customerCompany } : null;
  }
  if (kind === "s") {
    const rows = await all<{ serialNumber: string; productionOrderNo: string; customerCompany: string }>(
      db,
      `SELECT d.serialNumber, ${PO} AS productionOrderNo, ${CUSTOMER} AS customerCompany FROM devices d JOIN pi ON pi.id = d.piId WHERE d.serialNumber = ?`,
      key
    );
    return rows[0] ? { serialNumber: rows[0].serialNumber, orderNo: rows[0].productionOrderNo, customerCompany: rows[0].customerCompany } : null;
  }
  return null;
}

// Production order numbers and SNs that appear verbatim in a message (e.g. a
// customer writes "PO-2026-0901 keeps going offline"), matched against the
// database exactly — no guessing.
export async function findKnownReferences(db: D1Database, text: string): Promise<{ order: OrderMatch | null; device: DeviceMatch | null }> {
  const tokens = [...new Set((text.match(/[A-Za-z0-9][A-Za-z0-9._/-]{3,63}/g) ?? []).map((t) => t.replace(/[._/-]+$/, "").toUpperCase()))].slice(0, 30);
  if (!tokens.length) return { order: null, device: null };
  const marks = tokens.map(() => "?").join(",");
  const [devices, orders] = await Promise.all([
    all<DeviceMatch>(
      db,
      `SELECT d.serialNumber, d.piId, pi.piNo, ${PO} AS productionOrderNo, ${CUSTOMER} AS customerCompany
       FROM devices d JOIN pi ON pi.id = d.piId WHERE UPPER(d.serialNumber) IN (${marks}) LIMIT 1`,
      ...tokens
    ),
    all<OrderMatch>(
      db,
      `SELECT ${PO} AS productionOrderNo, ${CUSTOMER} AS customerCompany, pi.id AS piId, pi.piNo, linked.piNo AS linkedPiNo
       FROM pi LEFT JOIN pi linked ON linked.id = pi.linkedPiId
       WHERE ${APPROVED_ZH} AND UPPER(${PO}) IN (${marks}) ORDER BY pi.approvedAt DESC LIMIT 1`,
      ...tokens
    )
  ]);
  return { order: orders[0] ?? null, device: devices[0] ?? null };
}
