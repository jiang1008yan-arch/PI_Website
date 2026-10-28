import { all, first, id } from "../../lib/db";
import type { AppUser } from "../../lib/types";
import { normalizeSerial } from "../../lib/devices";
import { EFFECTIVE_ZH, effectiveHeader } from "../../lib/effectivePi";
import { buildFaultRanking, loadRepeatSettings, repeatInfo, repeatWindowStart, type FaultTicket, type ProductFaultCount } from "../../lib/faultStats";
import { canCreateTicket, canReadTicket, canUseTickets, seesOnlyOwnTickets, type TicketStatus } from "../../lib/ticketAccess";
import {
  addTicketAttachment,
  addTicketNote,
  assignTicket,
  changeTicketStatus,
  confirmTicketFault,
  createTicket,
  MAX_ATTACHMENT_BYTES,
  setTicketCustomer,
  setTicketProduct,
  setTicketType
} from "../../lib/ticketWorkflow";
import { afterTicketChange } from "../../lib/feishu/sync";
import { feishuEnabled, listBotChats } from "../../lib/feishu/client";
import { findSimilarTickets } from "../../lib/similarTickets";
import { body, createApp } from "./_shared";

export const ticketRoutes = createApp();

// Commerce works on PIs only; the after-sales module is closed to them.
for (const path of ["/tickets", "/tickets/*"]) {
  ticketRoutes.use(path, async (c, next) => {
    if (!canUseTickets(c.get("user"))) return c.json({ error: "Forbidden" }, 403);
    await next();
  });
}

// Paths under /tickets/ that are not a ticket id.
const NON_TICKET_PATHS = new Set(["products", "stats", "fault-ranking", "similar"]);

// Sales may open only the tickets in their name — the ticket itself and
// everything under it (attachments, assignment, …). Unknown ids fall through
// to each route's own 404.
for (const path of ["/tickets/:id", "/tickets/:id/*"]) {
  ticketRoutes.use(path, async (c, next) => {
    const user = c.get("user");
    const ticketId = c.req.param("id") ?? "";
    if (seesOnlyOwnTickets(user) && !NON_TICKET_PATHS.has(ticketId)) {
      const ticket = await first<{ assignedSalesId: string | null }>(c.env.DB, "SELECT assignedSalesId FROM tickets WHERE id = ?", ticketId);
      if (ticket && !canReadTicket(user, ticket)) return c.json({ error: "Not found" }, 404);
    }
    await next();
  });
}

// SQL condition limiting a query to the tickets this user may see (alias t).
function ticketScope(user: AppUser): { sql: string; params: unknown[] } | null {
  return seesOnlyOwnTickets(user) ? { sql: "t.assignedSalesId = ?", params: [user.id] } : null;
}

const TICKET_SELECT = `
  SELECT t.*, p.code AS productCode, p.nameEn AS productNameEn, p.nameZh AS productNameZh,
    sales.displayName AS assignedSalesName, service.displayName AS assignedServiceName
  FROM tickets t
  LEFT JOIN products p ON p.id = t.productId
  LEFT JOIN users sales ON sales.id = t.assignedSalesId
  LEFT JOIN users service ON service.id = t.assignedServiceId
`;

// ADMIN and SERVICE browse every ticket; SALES only the ones in their name.
// Optional filters: status, and product + confirmed fault type (statistics drill-down).
ticketRoutes.get("/tickets", async (c) => {
  const scope = ticketScope(c.get("user"));
  const where: string[] = scope ? [scope.sql] : [];
  const params: unknown[] = scope ? [...scope.params] : [];
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
            ${effectiveHeader("customerCompany")} AS customerCompany,
            ${effectiveHeader("productionOrderNo")} AS productionOrderNo
     FROM pi LEFT JOIN pi linked ON linked.id = pi.linkedPiId
     WHERE ${EFFECTIVE_ZH()} AND ${effectiveHeader("productionOrderNo")} = ?
     ORDER BY pi.approvedAt DESC`,
    value
  );
}

// Staff-created ticket (no customer link). ADMIN and SERVICE create tickets
// directly and name the responsible people (SALES cannot create). Product is
// required and the questionnaire is validated exactly like the public submission.
// Optionally a customer group the Feishu bot is in, told when the ticket is
// created and resolved.
ticketRoutes.post("/tickets", async (c) => {
  if (!canCreateTicket(c.get("user"))) return c.json({ error: "Your role cannot create tickets" }, 403);
  const d = await body<any>(c);
  const chatId = String(d.feishuSourceChatId ?? "").trim() || null;
  if (chatId) {
    const chats = feishuEnabled(c.env) ? await listBotChats(c.env).catch(() => []) : [];
    if (chatId === c.env.FEISHU_SERVICE_CHAT_ID || !chats.some((ch) => ch.chatId === chatId)) {
      return c.json({ error: "Choose a customer group the Feishu bot is in." }, 400);
    }
  }
  const created = await createTicket(
    c.env,
    { ...d, feishuSourceChatId: chatId, feishuSourceMessageId: null },
    { requireProduct: true, validateQuestionnaire: true, creator: c.get("user") }
  );
  afterTicketChange(c, created.id, created.changes);
  return c.json({ id: created.id, ticketNo: created.ticketNo });
});

// Earlier tickets like the one being created (SN, production order, customer,
// fault type): shown on the New ticket page before it is submitted.
ticketRoutes.get("/tickets/similar", async (c) => {
  if (!canCreateTicket(c.get("user"))) return c.json({ error: "Forbidden" }, 403);
  return c.json(
    await findSimilarTickets(
      c.env.DB,
      {
        serialNumber: c.req.query("serialNumber"),
        orderNo: c.req.query("orderNo"),
        customerCompany: c.req.query("customerCompany"),
        productId: c.req.query("productId"),
        faultType: c.req.query("faultType")
      },
      new Date()
    )
  );
});

// Catalog products a ticket can be about: identity columns of ACTIVE products
// only, never price or templates.
ticketRoutes.get("/tickets/products", async (c) =>
  c.json(await all(c.env.DB, "SELECT id, code, nameEn, nameZh FROM products WHERE status='ACTIVE' ORDER BY nameEn"))
);

// Lightweight stats: tickets by status and by product. Visible to all ticket
// roles; hit on every Home load.
ticketRoutes.get("/tickets/stats", async (c) => {
  const scope = ticketScope(c.get("user"));
  const where = scope ? `WHERE ${scope.sql}` : "";
  const params = scope?.params ?? [];
  const [byStatus, byProduct] = await Promise.all([
    all<{ status: string; n: number }>(c.env.DB, `SELECT t.status, COUNT(*) AS n FROM tickets t ${where} GROUP BY t.status`, ...params),
    all<{ productId: string; name: string; n: number }>(
      c.env.DB,
      `SELECT t.productId AS productId, COALESCE(p.nameEn, '(none)') AS name, COUNT(*) AS n
       FROM tickets t LEFT JOIN products p ON p.id = t.productId ${where} GROUP BY t.productId`,
      ...params
    )
  ]);
  return c.json({ byStatus, byProduct });
});

// Confirmed faults ranked by product · model · fault type over a period
// (?days=30|90|365|all, default the repeat window), each row flagged when its
// product has reached the repeat-fault threshold for that fault. Sales see
// only their own tickets in the rows; the repeat flags stay product-wide counts.
ticketRoutes.get("/tickets/fault-ranking", async (c) => {
  const scope = ticketScope(c.get("user"));
  const settings = await loadRepeatSettings(c.env.DB);
  const daysParam = c.req.query("days");
  const days = daysParam === "all" ? null : Number.isInteger(Number(daysParam)) && Number(daysParam) > 0 ? Number(daysParam) : settings.windowDays;
  const now = new Date();
  const [tickets, windowCounts] = await Promise.all([
    all<FaultTicket>(
      c.env.DB,
      `SELECT t.id, t.ticketNo, t.customerCompany, t.createdAt, t.productId, p.nameEn AS productName, t.productModel, t.faultType
       FROM tickets t LEFT JOIN products p ON p.id = t.productId
       WHERE t.faultType IS NOT NULL AND t.faultType <> '' AND t.createdAt >= ?${scope ? ` AND ${scope.sql}` : ""}`,
      days === null ? "" : repeatWindowStart(now, days),
      ...(scope?.params ?? [])
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
  // Sales keep the repeat count but see only their own tickets in its list.
  const user = c.get("user");
  if (repeat && seesOnlyOwnTickets(user)) repeat.tickets = repeat.tickets.filter((t) => canReadTicket(user, t));
  return c.json({ ticket, updates, fields, matchedPis, device, repeat, attachments });
});

// After-sales record which PI line the issue is about: the catalog product,
// the concrete generated model, and the device SN if known.
// The SN must be known to the system (registered on a PI or reported by the
// charger backend). Fields left out keep their value.
ticketRoutes.patch("/tickets/:id/product", async (c) => {
  const d = await body<{ productId?: string; productModel?: string | null; serialNumber?: string | null }>(c);
  const result = await setTicketProduct(c.env.DB, c.get("user"), c.req.param("id"), d);
  afterTicketChange(c, c.req.param("id"), result.changes);
  return c.json({ ok: true });
});

// After-sales confirm the fault type (from the maintained list). Only
// confirmed fault types count in statistics and repeat-fault checks.
ticketRoutes.patch("/tickets/:id/fault", async (c) => {
  const d = await body<{ faultType?: string }>(c);
  const confirmed = await confirmTicketFault(c.env.DB, c.get("user"), c.req.param("id"), String(d.faultType ?? ""));
  afterTicketChange(c, c.req.param("id"), confirmed.changes);
  return c.json({ ok: true, repeat: confirmed.repeat });
});

ticketRoutes.patch("/tickets/:id/status", async (c) => {
  const d = await body<{ status?: string }>(c);
  const change = await changeTicketStatus(c.env.DB, c.get("user"), c.req.param("id"), d.status as TicketStatus);
  afterTicketChange(c, c.req.param("id"), change.changes);
  return c.json({ ok: true });
});

// A progress update, or (with parentId) a follow-up to an earlier one. With
// withAttachments the text may be empty; the files are uploaded next.
ticketRoutes.post("/tickets/:id/notes", async (c) => {
  const d = await body<{ note?: string; parentId?: string; withAttachments?: boolean }>(c);
  const added = await addTicketNote(c.env.DB, c.get("user"), c.req.param("id"), String(d.note ?? ""), {
    parentId: d.parentId || null,
    withAttachments: Boolean(d.withAttachments)
  });
  afterTicketChange(c, c.req.param("id"), added.changes);
  return c.json({ ok: true, id: added.id });
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
  afterTicketChange(c, c.req.param("id"), result.changes);
  return c.json({ ok: true });
});

// After-sales correct the customer, production order number and contact.
ticketRoutes.patch("/tickets/:id/customer", async (c) => {
  const d = await body<{ customerCompany?: string; orderNo?: string; contactName?: string; contactInfo?: string }>(c);
  const result = await setTicketCustomer(c.env.DB, c.get("user"), c.req.param("id"), d);
  afterTicketChange(c, c.req.param("id"), result.changes);
  return c.json({ ok: true });
});

// After-sales classify the ticket (fault / product request / other) and may
// set its one-line summary. Product requests go to the requirement pool.
ticketRoutes.patch("/tickets/:id/type", async (c) => {
  const d = await body<{ ticketType?: string; summary?: string }>(c);
  const result = await setTicketType(c.env.DB, c.get("user"), c.req.param("id"), d);
  afterTicketChange(c, c.req.param("id"), result.changes);
  return c.json({ ok: true });
});
