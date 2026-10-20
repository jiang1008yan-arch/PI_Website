import { all, first, id } from "../../lib/db";
import { isKnownSerial, normalizeSerial } from "../../lib/devices";
import { buildFaultRanking, isRepeatFault, repeatSettings, repeatWindowStart, type FaultTicket, type ProductFaultCount } from "../../lib/faultStats";
import { canConfirmFault, canUseTickets, type TicketStatus } from "../../lib/ticketAccess";
import {
  addTicketAttachment,
  addTicketNote,
  assignTicket,
  changeTicketStatus,
  confirmTicketFault,
  createTicket,
  MAX_ATTACHMENT_BYTES,
  setTicketCustomer,
  setTicketType
} from "../../lib/ticketService";
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
  for (const [query, column] of [["status", "t.status"], ["productId", "t.productId"], ["faultType", "t.faultType"], ["productModel", "t.productModel"], ["ticketType", "t.ticketType"]] as const) {
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
  const created = await createTicket(c.env, d, { requireProduct: true, validateQuestionnaire: true, creator: c.get("user") });
  afterTicketChange(c, created.id, { kind: "created" });
  return c.json(created);
});

// Catalog products a ticket can be about: identity columns of ACTIVE products
// only, never price or templates.
ticketRoutes.get("/tickets/products", async (c) =>
  c.json(await all(c.env.DB, "SELECT id, code, nameEn, nameZh FROM products WHERE status='ACTIVE' ORDER BY nameEn"))
);

// Lightweight stats: tickets by status and by product. Visible to all ticket
// roles; hit on every Home load.
ticketRoutes.get("/tickets/stats", async (c) => {
  const [byStatus, byProduct] = await Promise.all([
    all<{ status: string; n: number }>(c.env.DB, "SELECT status, COUNT(*) AS n FROM tickets GROUP BY status"),
    all<{ productId: string; name: string; n: number }>(
      c.env.DB,
      `SELECT t.productId AS productId, COALESCE(p.nameEn, '(none)') AS name, COUNT(*) AS n
       FROM tickets t LEFT JOIN products p ON p.id = t.productId GROUP BY t.productId`
    )
  ]);
  return c.json({ byStatus, byProduct });
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
  const attachments = await all(
    c.env.DB,
    "SELECT id, updateId, fileName, contentType, size, createdAt FROM ticketAttachments WHERE ticketId = ? ORDER BY createdAt, rowid",
    ticket.id
  );
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
  return c.json({ ticket, updates, fields, matchedPis, device, repeat, attachments });
});

// After-sales record which PI line the issue is about: the catalog product,
// the concrete generated model, and the device SN if known.
// The SN must be known to the system (registered on a PI or reported by the
// charger backend). Fields left out keep their value.
ticketRoutes.patch("/tickets/:id/product", async (c) => {
  if (!canConfirmFault(c.get("user"))) return c.json({ error: "Forbidden" }, 403);
  const d = await body<{ productId?: string; productModel?: string | null; serialNumber?: string | null }>(c);
  const ticket = await first<any>(c.env.DB, "SELECT id, productId, productModel, serialNumber FROM tickets WHERE id=?", c.req.param("id"));
  if (!ticket) return c.json({ error: "Not found" }, 404);
  let productId = ticket.productId;
  if (d.productId !== undefined) {
    const product = await first<{ id: string }>(c.env.DB, "SELECT id FROM products WHERE id=?", String(d.productId));
    if (!product) return c.json({ error: "A valid product is required." }, 400);
    productId = product.id;
  }
  const productModel = d.productModel === undefined ? ticket.productModel : String(d.productModel ?? "").trim().slice(0, 300) || null;
  const serialNumber = d.serialNumber === undefined ? ticket.serialNumber : normalizeSerial(d.serialNumber).slice(0, 64) || null;
  if (serialNumber && serialNumber !== ticket.serialNumber && !(await isKnownSerial(c.env.DB, serialNumber))) {
    return c.json({ error: "That SN is not known to the system." }, 400);
  }
  await c.env.DB.prepare("UPDATE tickets SET productId=?, productModel=?, serialNumber=?, updatedAt=CURRENT_TIMESTAMP WHERE id=?")
    .bind(productId, productModel, serialNumber, ticket.id)
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

// A progress update, or (with parentId) a follow-up to an earlier one. With
// withAttachments the text may be empty; the files are uploaded next.
ticketRoutes.post("/tickets/:id/notes", async (c) => {
  const d = await body<{ note?: string; parentId?: string; withAttachments?: boolean }>(c);
  const updateId = await addTicketNote(c.env.DB, c.get("user"), c.req.param("id"), String(d.note ?? ""), {
    parentId: d.parentId || null,
    withAttachments: Boolean(d.withAttachments)
  });
  afterTicketChange(c, c.req.param("id"), { kind: "note" });
  return c.json({ ok: true, id: updateId });
});

// One file per request: the raw body, its content type, and the file name
// (URI-encoded) in X-File-Name.
ticketRoutes.post("/tickets/:id/updates/:updateId/attachments", async (c) => {
  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > MAX_ATTACHMENT_BYTES) return c.json({ error: "Files can be at most 20 MB." }, 400);
  let name = "file";
  try {
    name = decodeURIComponent(c.req.header("x-file-name") ?? "file");
  } catch {
    // keep the default name
  }
  const attachment = await addTicketAttachment(c.env, c.get("user"), c.req.param("id"), c.req.param("updateId"), {
    name,
    contentType: c.req.header("content-type") ?? "application/octet-stream",
    body: await c.req.arrayBuffer()
  });
  return c.json(attachment);
});

// Download (or, with ?inline=1, show) an attachment. Signed-in ticket users only.
ticketRoutes.get("/tickets/:id/attachments/:attachmentId", async (c) => {
  const row = await first<{ fileName: string; contentType: string; r2Key: string }>(
    c.env.DB,
    "SELECT fileName, contentType, r2Key FROM ticketAttachments WHERE id = ? AND ticketId = ?",
    c.req.param("attachmentId"),
    c.req.param("id")
  );
  if (!row) return c.json({ error: "Not found" }, 404);
  const obj = await c.env.FILES.get(row.r2Key);
  if (!obj) return c.json({ error: "Not found" }, 404);
  const inline = c.req.query("inline") === "1" && row.contentType.startsWith("image/");
  return new Response(obj.body, {
    headers: {
      "content-type": row.contentType,
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff"
    }
  });
});

// Assign/backfill responsible people. ADMIN may set both sides; SERVICE may set
// the service side; SALES may set the sales side. Changes go on the timeline and
// the new owner is told in Feishu.
ticketRoutes.patch("/tickets/:id/assign", async (c) => {
  const d = await body<{ assignedSalesId?: string | null; assignedServiceId?: string | null }>(c);
  const result = await assignTicket(c.env.DB, c.get("user"), c.req.param("id"), d);
  const newOwnerIds = [result.newServiceOwnerId, result.newSalesOwnerId].filter((v): v is string => Boolean(v) && v !== c.get("user").id);
  if (result.changed) afterTicketChange(c, c.req.param("id"), { kind: "assigned", newOwnerIds });
  return c.json({ ok: true });
});

// After-sales correct the customer, production order number and contact.
ticketRoutes.patch("/tickets/:id/customer", async (c) => {
  const d = await body<{ customerCompany?: string; orderNo?: string; contactName?: string; contactInfo?: string }>(c);
  if (await setTicketCustomer(c.env.DB, c.get("user"), c.req.param("id"), d)) afterTicketChange(c, c.req.param("id"), { kind: "product" });
  return c.json({ ok: true });
});

// After-sales classify the ticket (fault / product request / other) and may
// set its one-line summary. Product requests go to the requirement pool.
ticketRoutes.patch("/tickets/:id/type", async (c) => {
  const d = await body<{ ticketType?: string; summary?: string }>(c);
  const result = await setTicketType(c.env.DB, c.get("user"), c.req.param("id"), d);
  afterTicketChange(c, c.req.param("id"), { kind: "type", ticketType: result.ticketType, toPool: result.becameProductRequest });
  return c.json({ ok: true });
});
