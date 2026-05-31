import { all, first, id } from "../../lib/db";
import { canChangeStatus, canWriteNote, isValidTransition, type TicketStatus } from "../../lib/ticketAccess";
import { validateAnswers, type TicketFieldRow } from "../../lib/ticketAnswers";
import { nextTicketNumber } from "../../lib/ticketNumber";
import { body, createApp } from "./_shared";

export const ticketRoutes = createApp();

const TICKET_SELECT = `
  SELECT t.*, p.code AS productCode, p.nameEn AS productNameEn, p.nameZh AS productNameZh,
    sales.displayName AS assignedSalesName, service.displayName AS assignedServiceName
  FROM tickets t
  LEFT JOIN products p ON p.id = t.productId
  LEFT JOIN users sales ON sales.id = t.assignedSalesId
  LEFT JOIN users service ON service.id = t.assignedServiceId
`;

// All three roles can browse every ticket (no ownership filter).
ticketRoutes.get("/tickets", async (c) => {
  const status = c.req.query("status");
  const where = status ? "WHERE t.status = ?" : "";
  const params = status ? [status] : [];
  return c.json(
    await all(c.env.DB, `${TICKET_SELECT} ${where} ORDER BY t.createdAt DESC`, ...params)
  );
});

// Staff-created ticket (no customer link). ADMIN, SALES and SERVICE may all
// create tickets directly and name the responsible people. Product is required
// and the questionnaire is validated exactly like the public submission.
ticketRoutes.post("/tickets", async (c) => {
  const d = await body<any>(c);
  const customerCompany = String(d.customerCompany ?? "").trim().slice(0, 200);
  const orderNo = String(d.orderNo ?? "").trim().slice(0, 100);
  const contactName = String(d.contactName ?? "").trim();
  const contactInfo = String(d.contactInfo ?? "").trim();
  if (!contactName || contactName.length > 200) return c.json({ error: "A valid contact name is required." }, 400);
  if (!contactInfo || contactInfo.length > 200) return c.json({ error: "Valid contact details are required." }, 400);

  const product = d.productId
    ? await first<{ id: string }>(c.env.DB, "SELECT id FROM products WHERE id=? AND status='ACTIVE'", String(d.productId))
    : null;
  if (!product) return c.json({ error: "A valid product is required." }, 400);

  const fields = await all<TicketFieldRow>(
    c.env.DB,
    "SELECT id, label, fieldType, options, required FROM ticketFields ORDER BY sortOrder, label"
  );
  const validated = validateAnswers(fields, d.answers);
  if (!validated.ok) return c.json({ error: validated.error }, 400);

  const date = new Date().toISOString().slice(0, 10);
  const { seq, ticketNo } = await nextTicketNumber(c.env, date);
  const ticketId = id("tkt");
  await c.env.DB.prepare(
    `INSERT INTO tickets (id, ticketNo, seq, status, customerCompany, orderNo, contactName, contactInfo, productId, answers, assignedSalesId, assignedServiceId, linkId)
     VALUES (?, ?, ?, 'NEW', ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
  )
    .bind(
      ticketId,
      ticketNo,
      seq,
      customerCompany,
      orderNo,
      contactName,
      contactInfo,
      product.id,
      JSON.stringify(validated.answers),
      d.assignedSalesId || null,
      d.assignedServiceId || null
    )
    .run();
  return c.json({ id: ticketId, ticketNo });
});

// Lightweight stats: by status, by problem-type (first DROPDOWN questionnaire
// field), by product. Visible to all three roles.
ticketRoutes.get("/tickets/stats", async (c) => {
  const byStatus = await all<{ status: string; n: number }>(
    c.env.DB,
    "SELECT status, COUNT(*) AS n FROM tickets GROUP BY status"
  );
  const byProduct = await all<{ productId: string; name: string; n: number }>(
    c.env.DB,
    `SELECT t.productId AS productId, COALESCE(p.nameEn, '(none)') AS name, COUNT(*) AS n
     FROM tickets t LEFT JOIN products p ON p.id = t.productId GROUP BY t.productId`
  );
  const problemField = await first<{ id: string; label: string; options: string | null }>(
    c.env.DB,
    "SELECT id, label, options FROM ticketFields WHERE fieldType='DROPDOWN' ORDER BY sortOrder, label LIMIT 1"
  );
  let problemType: { label: string; counts: Record<string, number> } | null = null;
  if (problemField) {
    const rows = await all<{ answers: string }>(c.env.DB, "SELECT answers FROM tickets");
    const counts: Record<string, number> = {};
    for (const r of rows) {
      try {
        const a = JSON.parse(r.answers) as Record<string, string>;
        const v = a[problemField.id];
        if (v) counts[v] = (counts[v] ?? 0) + 1;
      } catch {
        /* ignore malformed */
      }
    }
    problemType = { label: problemField.label, counts };
  }
  return c.json({ byStatus, byProduct, problemType });
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
  return c.json({ ticket, updates, fields });
});

ticketRoutes.patch("/tickets/:id/status", async (c) => {
  const user = c.get("user");
  if (!canChangeStatus(user)) return c.json({ error: "Forbidden" }, 403);
  const d = await body<{ status?: string }>(c);
  const ticket = await first<any>(c.env.DB, "SELECT * FROM tickets WHERE id=?", c.req.param("id"));
  if (!ticket) return c.json({ error: "Not found" }, 404);
  const to = d.status as TicketStatus;
  if (!isValidTransition(ticket.status as TicketStatus, to)) {
    return c.json({ error: `Cannot move from ${ticket.status} to ${to}` }, 400);
  }
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE tickets SET status=?, updatedAt=CURRENT_TIMESTAMP WHERE id=?").bind(to, ticket.id),
    c.env.DB
      .prepare(
        "INSERT INTO ticketUpdates (id, ticketId, actorId, kind, statusFrom, statusTo) VALUES (?, ?, ?, 'STATUS', ?, ?)"
      )
      .bind(id("tup"), ticket.id, user.id, ticket.status, to)
  ]);
  return c.json({ ok: true });
});

ticketRoutes.post("/tickets/:id/notes", async (c) => {
  const user = c.get("user");
  if (!canWriteNote(user)) return c.json({ error: "Forbidden" }, 403);
  const d = await body<{ note?: string }>(c);
  const note = String(d.note ?? "").trim();
  if (!note) return c.json({ error: "Note is required" }, 400);
  const ticket = await first<any>(c.env.DB, "SELECT id FROM tickets WHERE id=?", c.req.param("id"));
  if (!ticket) return c.json({ error: "Not found" }, 404);
  await c.env.DB.prepare(
    "INSERT INTO ticketUpdates (id, ticketId, actorId, kind, note) VALUES (?, ?, ?, 'NOTE', ?)"
  )
    .bind(id("tup"), ticket.id, user.id, note.slice(0, 4000))
    .run();
  await c.env.DB.prepare("UPDATE tickets SET updatedAt=CURRENT_TIMESTAMP WHERE id=?").bind(ticket.id).run();
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
  if (d.assignedSalesId !== undefined && (user.role === "ADMIN" || user.role === "SALES")) {
    sets.push("assignedSalesId=?");
    binds.push(d.assignedSalesId || null);
  }
  if (d.assignedServiceId !== undefined && (user.role === "ADMIN" || user.role === "SERVICE")) {
    sets.push("assignedServiceId=?");
    binds.push(d.assignedServiceId || null);
  }
  if (!sets.length) return c.json({ error: "Nothing to update" }, 400);
  sets.push("updatedAt=CURRENT_TIMESTAMP");
  binds.push(ticket.id);
  await c.env.DB.prepare(`UPDATE tickets SET ${sets.join(", ")} WHERE id=?`).bind(...binds).run();
  return c.json({ ok: true });
});
