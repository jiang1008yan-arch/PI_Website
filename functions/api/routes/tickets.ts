import { all, first, id } from "../../lib/db";
import { normalizeSerial } from "../../lib/devices";
import { buildFaultRanking, isRepeatFault, repeatSettings, repeatWindowStart, type FaultTicket, type ProductFaultCount } from "../../lib/faultStats";
import {
  canAssignSalesSide,
  canAssignServiceSide,
  canConfirmFault,
  canUseTickets,
  type TicketStatus
} from "../../lib/ticketAccess";
import { addTicketNote, changeTicketStatus, confirmTicketFault, createTicket } from "../../lib/ticketService";
import { afterTicketChange } from "../../lib/feishu/sync";
import { body, createApp } from "./_shared";

export const ticketRoutes = createApp();

// Commerce works on PIs only; the after-sales module is closed to them.
for (const path of ["/tickets", "/tickets/*"]) {
  ticketRoutes.use(path, async (c, next) => {
    if (!canUseTickets(c.get("user"))) return c.json({ error: "Forbidden" }, 403);
    await next();
  });
}

const TICKET_SELECT = `
  SELECT t.*, p.code AS productCode, p.nameEn AS productNameEn, p.nameZh AS productNameZh,
    sales.displayName AS assignedSalesName, service.displayName AS assignedServiceName
  FROM tickets t
  LEFT JOIN products p ON p.id = t.productId
  LEFT JOIN users sales ON sales.id = t.assignedSalesId
  LEFT JOIN users service ON service.id = t.assignedServiceId
`;

// All three roles can browse every ticket (no ownership filter). Optional
// filters: status, and product + confirmed fault type (statistics drill-down).
ticketRoutes.get("/tickets", async (c) => {
  const where: string[] = [];
  const params: unknown[] = [];
  for (const [query, column] of [["status", "t.status"], ["productId", "t.productId"], ["faultType", "t.faultType"], ["productModel", "t.productModel"]] as const) {
    const value = c.req.query(query);
    if (value) {
      where.push(`${column} = ?`);
      params.push(value);
    }
  }
  return c.json(
    await all(c.env.DB, `${TICKET_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY t.createdAt DESC`, ...params)
  );
});

// The approved Chinese PIs a production order number points at (normally one;
// legacy data may repeat a number). Reads the effective version's number.
async function approvedPisForOrder(db: D1Database, orderNo: string) {
  const value = orderNo.trim();
  if (!value) return [];
  return await all(
    db,
    `SELECT pi.id, pi.piNo, pi.status, pi.revisionNo, pi.revisionInProgress, linked.piNo AS linkedPiNo, pi.linkedPiNoSnapshot,
            COALESCE(json_extract(pi.effectiveSnapshot, '$.zh.header.customerCompany'), pi.customerCompany) AS customerCompany,
            COALESCE(json_extract(pi.effectiveSnapshot, '$.zh.header.productionOrderNo'), pi.productionOrderNo) AS productionOrderNo
     FROM pi LEFT JOIN pi linked ON linked.id = pi.linkedPiId
     WHERE pi.language = 'ZH' AND (pi.status = 'APPROVED' OR pi.revisionInProgress = 1)
       AND TRIM(COALESCE(json_extract(pi.effectiveSnapshot, '$.zh.header.productionOrderNo'), pi.productionOrderNo)) = ?
     ORDER BY pi.approvedAt DESC`,
    value
  );
}

async function loadRepeatSettings(db: D1Database) {
  const rows = await all<{ optionKey: string; value: string }>(
    db,
    "SELECT optionKey, value FROM appOptions WHERE optionKey IN ('repeatFaultDays', 'repeatFaultThreshold')"
  );
  const get = (key: string) => rows.find((r) => r.optionKey === key)?.value;
  return repeatSettings(get("repeatFaultDays"), get("repeatFaultThreshold"));
}

// How often this product has had this confirmed fault within the window.
async function repeatInfo(db: D1Database, productId: string | null, faultType: string | null, now: Date) {
  if (!productId || !faultType) return null;
  const settings = await loadRepeatSettings(db);
  const since = repeatWindowStart(now, settings.windowDays);
  const tickets = await all<{ id: string; ticketNo: string; createdAt: string; customerCompany: string; productModel: string | null }>(
    db,
    `SELECT id, ticketNo, createdAt, customerCompany, productModel FROM tickets
     WHERE productId = ? AND faultType = ? AND createdAt >= ? ORDER BY createdAt DESC`,
    productId,
    faultType,
    since
  );
  return { count: tickets.length, windowDays: settings.windowDays, threshold: settings.threshold, isRepeat: isRepeatFault(tickets.length, settings), tickets };
}

// Staff-created ticket (no customer link). ADMIN, SALES and SERVICE may all
// create tickets directly and name the responsible people. Product is required
// and the questionnaire is validated exactly like the public submission.
ticketRoutes.post("/tickets", async (c) => {
  const d = await body<any>(c);
  const created = await createTicket(c.env, d, { requireProduct: true, validateQuestionnaire: true });
  afterTicketChange(c, created.id, { kind: "created" });
  return c.json(created);
});

// Lightweight stats: by status, by problem-type (first DROPDOWN questionnaire
// field), by product. Visible to all three roles.
ticketRoutes.get("/tickets/stats", async (c) => {
  // The three aggregates are independent — run them in one parallel wave instead
  // of four serial round-trips (this endpoint is hit on every Home load).
  const [byStatus, byProduct, problemField] = await Promise.all([
    all<{ status: string; n: number }>(
      c.env.DB,
      "SELECT status, COUNT(*) AS n FROM tickets GROUP BY status"
    ),
    all<{ productId: string; name: string; n: number }>(
      c.env.DB,
      `SELECT t.productId AS productId, COALESCE(p.nameEn, '(none)') AS name, COUNT(*) AS n
       FROM tickets t LEFT JOIN products p ON p.id = t.productId GROUP BY t.productId`
    ),
    first<{ id: string; label: string; options: string | null }>(
      c.env.DB,
      "SELECT id, label, options FROM ticketFields WHERE fieldType='DROPDOWN' ORDER BY sortOrder, label LIMIT 1"
    )
  ]);
  let problemType: { label: string; counts: Record<string, number> } | null = null;
  if (problemField) {
    // Aggregate the chosen problem field in SQL (json_extract) instead of pulling
    // every ticket's answers blob into the worker and counting in JS. json_valid
    // guards against any malformed rows so one bad blob can't fail the query.
    const path = `$.${problemField.id}`;
    const rows = await all<{ v: string; n: number }>(
      c.env.DB,
      `SELECT json_extract(answers, ?) AS v, COUNT(*) AS n
       FROM tickets
       WHERE json_valid(answers) = 1 AND json_extract(answers, ?) IS NOT NULL AND json_extract(answers, ?) <> ''
       GROUP BY v`,
      path,
      path,
      path
    );
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.v] = r.n;
    problemType = { label: problemField.label, counts };
  }
  return c.json({ byStatus, byProduct, problemType });
});

// Confirmed faults ranked by product · model · fault type over a period
// (?days=30|90|365|all, default the repeat window), each row flagged when its
// product has reached the repeat-fault threshold for that fault.
ticketRoutes.get("/tickets/fault-ranking", async (c) => {
  const settings = await loadRepeatSettings(c.env.DB);
  const daysParam = c.req.query("days");
  const days = daysParam === "all" ? null : Number.isInteger(Number(daysParam)) && Number(daysParam) > 0 ? Number(daysParam) : settings.windowDays;
  const now = new Date();
  const [tickets, windowCounts] = await Promise.all([
    all<FaultTicket>(
      c.env.DB,
      `SELECT t.id, t.ticketNo, t.customerCompany, t.createdAt, t.productId, p.nameEn AS productName, t.productModel, t.faultType
       FROM tickets t LEFT JOIN products p ON p.id = t.productId
       WHERE t.faultType IS NOT NULL AND t.faultType <> '' AND t.createdAt >= ?`,
      days === null ? "" : repeatWindowStart(now, days)
    ),
    all<ProductFaultCount>(
      c.env.DB,
      `SELECT productId, faultType, COUNT(*) AS n FROM tickets
       WHERE faultType IS NOT NULL AND faultType <> '' AND createdAt >= ?
       GROUP BY productId, faultType`,
      repeatWindowStart(now, settings.windowDays)
    )
  ]);
  return c.json({
    rows: buildFaultRanking(tickets, windowCounts, settings),
    days: days ?? "all",
    windowDays: settings.windowDays,
    threshold: settings.threshold
  });
});

ticketRoutes.get("/tickets/:id", async (c) => {
  const ticket = await first<any>(c.env.DB, `${TICKET_SELECT} WHERE t.id = ?`, c.req.param("id"));
  if (!ticket) return c.json({ error: "Not found" }, 404);
  const updates = await all(
    c.env.DB,
    `SELECT u.*, users.displayName AS actorName FROM ticketUpdates u
     LEFT JOIN users ON users.id = u.actorId WHERE u.ticketId = ? ORDER BY u.createdAt`,
    ticket.id
  );
  const fields = await all(c.env.DB, "SELECT * FROM ticketFields ORDER BY sortOrder, label");
  const matchedPis = await approvedPisForOrder(c.env.DB, String(ticket.orderNo ?? ""));
  const serial = normalizeSerial(ticket.serialNumber);
  const device = serial
    ? await first(
        c.env.DB,
        `SELECT d.serialNumber, pi.id AS piId, pi.piNo, linked.piNo AS linkedPiNo, pi.linkedPiNoSnapshot, pi.productionOrderNo
         FROM devices d JOIN pi ON pi.id = d.piId LEFT JOIN pi linked ON linked.id = pi.linkedPiId WHERE d.serialNumber = ?`,
        serial
      )
    : null;
  const repeat = await repeatInfo(c.env.DB, ticket.productId, ticket.faultType, new Date());
  return c.json({ ticket, updates, fields, matchedPis, device, repeat });
});

// After-sales record which PI line the issue is about: the catalog product,
// the concrete generated model, and the device SN if known.
ticketRoutes.patch("/tickets/:id/product", async (c) => {
  if (!canConfirmFault(c.get("user"))) return c.json({ error: "Forbidden" }, 403);
  const d = await body<{ productId?: string; productModel?: string; serialNumber?: string }>(c);
  const ticket = await first<any>(c.env.DB, "SELECT id FROM tickets WHERE id=?", c.req.param("id"));
  if (!ticket) return c.json({ error: "Not found" }, 404);
  const product = d.productId ? await first<{ id: string }>(c.env.DB, "SELECT id FROM products WHERE id=?", String(d.productId)) : null;
  if (!product) return c.json({ error: "A valid product is required." }, 400);
  await c.env.DB.prepare("UPDATE tickets SET productId=?, productModel=?, serialNumber=?, updatedAt=CURRENT_TIMESTAMP WHERE id=?")
    .bind(product.id, String(d.productModel ?? "").trim().slice(0, 300) || null, normalizeSerial(d.serialNumber).slice(0, 64) || null, ticket.id)
    .run();
  afterTicketChange(c, ticket.id, { kind: "product" });
  return c.json({ ok: true });
});

// After-sales confirm the fault type (from the maintained list). Only
// confirmed fault types count in statistics and repeat-fault checks.
ticketRoutes.patch("/tickets/:id/fault", async (c) => {
  const d = await body<{ faultType?: string }>(c);
  const confirmed = await confirmTicketFault(c.env.DB, c.get("user"), c.req.param("id"), String(d.faultType ?? ""));
  const repeat = await repeatInfo(c.env.DB, confirmed.productId, confirmed.faultType, new Date());
  afterTicketChange(c, c.req.param("id"), { kind: "fault", repeat: repeat?.isRepeat ? repeat : null });
  return c.json({ ok: true, repeat });
});

ticketRoutes.patch("/tickets/:id/status", async (c) => {
  const d = await body<{ status?: string }>(c);
  const change = await changeTicketStatus(c.env.DB, c.get("user"), c.req.param("id"), d.status as TicketStatus);
  afterTicketChange(c, c.req.param("id"), { kind: "status", to: change.to });
  return c.json({ ok: true });
});

ticketRoutes.post("/tickets/:id/notes", async (c) => {
  const d = await body<{ note?: string }>(c);
  await addTicketNote(c.env.DB, c.get("user"), c.req.param("id"), String(d.note ?? ""));
  afterTicketChange(c, c.req.param("id"), { kind: "note" });
  return c.json({ ok: true });
});

// Assign/backfill responsible people. ADMIN may set both sides; SERVICE may set
// the service side; SALES may set the sales side.
ticketRoutes.patch("/tickets/:id/assign", async (c) => {
  const user = c.get("user");
  const d = await body<{ assignedSalesId?: string | null; assignedServiceId?: string | null }>(c);
  const ticket = await first<any>(c.env.DB, "SELECT * FROM tickets WHERE id=?", c.req.param("id"));
  if (!ticket) return c.json({ error: "Not found" }, 404);
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (d.assignedSalesId !== undefined && canAssignSalesSide(user)) {
    sets.push("assignedSalesId=?");
    binds.push(d.assignedSalesId || null);
  }
  if (d.assignedServiceId !== undefined && canAssignServiceSide(user)) {
    sets.push("assignedServiceId=?");
    binds.push(d.assignedServiceId || null);
  }
  if (!sets.length) return c.json({ error: "Nothing to update" }, 400);
  sets.push("updatedAt=CURRENT_TIMESTAMP");
  binds.push(ticket.id);
  await c.env.DB.prepare(`UPDATE tickets SET ${sets.join(", ")} WHERE id=?`).bind(...binds).run();
  return c.json({ ok: true });
});
