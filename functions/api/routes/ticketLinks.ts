import { all, first, id } from "../../lib/db";
import { canGenerateLink } from "../../lib/ticketAccess";
import { body, createApp } from "./_shared";

export const ticketLinkRoutes = createApp();

const LINK_TTL_DAYS = 7;

// Generate a tokenized public link. The generator always owns their own side
// (SALES -> sales=self, SERVICE -> service=self) and MUST name the counterpart:
// SALES picks the service contact, SERVICE picks the sales contact. ADMIN has no
// "side" and must name at least one. Only ADMIN can later change names freely.
ticketLinkRoutes.post("/ticket-links", async (c) => {
  const user = c.get("user");
  if (!canGenerateLink(user)) return c.json({ error: "Forbidden" }, 403);
  const d = await body<any>(c);

  let assignedSalesId: string | null = d.assignedSalesId || null;
  let assignedServiceId: string | null = d.assignedServiceId || null;
  if (user.role === "SALES") {
    assignedSalesId = user.id; // own side is fixed to self
    if (!assignedServiceId) return c.json({ error: "Please choose the service contact for this link." }, 400);
  } else if (user.role === "SERVICE") {
    assignedServiceId = user.id; // own side is fixed to self
    if (!assignedSalesId) return c.json({ error: "Please choose the sales contact for this link." }, 400);
  } else if (!assignedSalesId && !assignedServiceId) {
    return c.json({ error: "At least one assignee (sales or service) is required" }, 400);
  }

  const linkId = id("tlk");
  const token = id("tok");
  const expiresAt = new Date(Date.now() + LINK_TTL_DAYS * 86400000).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO ticketLinks (id, token, customerCompany, orderNo, createdById, createdByRole, assignedSalesId, assignedServiceId, expiresAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      linkId,
      token,
      String(d.customerCompany ?? "").slice(0, 200),
      String(d.orderNo ?? "").slice(0, 100),
      user.id,
      user.role,
      assignedSalesId,
      assignedServiceId,
      expiresAt
    )
    .run();
  return c.json({ id: linkId, token, expiresAt, path: `/ticket/new?t=${token}` });
});

// SALES/SERVICE see their own links; ADMIN sees all. Includes a usage count.
ticketLinkRoutes.get("/ticket-links", async (c) => {
  const user = c.get("user");
  const where = user.role === "ADMIN" ? "1=1" : "l.createdById = ?";
  const params = user.role === "ADMIN" ? [] : [user.id];
  return c.json(
    await all(
      c.env.DB,
      `SELECT l.*, (SELECT COUNT(*) FROM tickets t WHERE t.linkId = l.id) AS useCount
       FROM ticketLinks l WHERE ${where} ORDER BY l.createdAt DESC`,
      ...params
    )
  );
});

ticketLinkRoutes.post("/ticket-links/:id/revoke", async (c) => {
  const user = c.get("user");
  const row = await first<any>(c.env.DB, "SELECT * FROM ticketLinks WHERE id=?", c.req.param("id"));
  if (!row) return c.json({ error: "Not found" }, 404);
  if (user.role !== "ADMIN" && row.createdById !== user.id) return c.json({ error: "Forbidden" }, 403);
  await c.env.DB.prepare("UPDATE ticketLinks SET revokedAt=CURRENT_TIMESTAMP WHERE id=?")
    .bind(row.id)
    .run();
  return c.json({ ok: true });
});
