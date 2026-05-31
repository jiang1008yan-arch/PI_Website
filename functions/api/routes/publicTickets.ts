import { all, first, id } from "../../lib/db";
import { nextTicketNumber } from "../../lib/ticketNumber";
import { validateAnswers, type TicketFieldRow } from "../../lib/ticketAnswers";
import { verifyTurnstile } from "../../lib/turnstile";
import { body, createApp } from "./_shared";

export const publicTicketRoutes = createApp();

type LinkRow = {
  id: string;
  customerCompany: string;
  orderNo: string;
  assignedSalesId: string | null;
  assignedServiceId: string | null;
  expiresAt: string;
  revokedAt: string | null;
};

async function resolveLink(db: D1Database, token: unknown): Promise<LinkRow | null> {
  if (typeof token !== "string" || !token) return null;
  const link = await first<LinkRow>(db, "SELECT * FROM ticketLinks WHERE token=?", token);
  if (!link) return null;
  if (link.revokedAt) return null;
  if (new Date(link.expiresAt).getTime() < Date.now()) return null;
  return link;
}

// Prebound info + questionnaire config for rendering the public form.
publicTicketRoutes.get("/public/ticket-form", async (c) => {
  const link = await resolveLink(c.env.DB, c.req.query("t"));
  if (!link) return c.json({ error: "This link is invalid or has expired." }, 404);
  const fields = await all(c.env.DB, "SELECT * FROM ticketFields ORDER BY sortOrder, label");
  return c.json({
    customerCompany: link.customerCompany,
    orderNo: link.orderNo,
    fields
  });
});

// Whitelisted product master data — ONLY non-sensitive identity columns for
// ACTIVE products. Never price/cost/templates.
publicTicketRoutes.get("/public/products", async (c) =>
  c.json(
    await all(
      c.env.DB,
      "SELECT id, code, nameEn, nameZh FROM products WHERE status='ACTIVE' ORDER BY nameEn"
    )
  )
);

publicTicketRoutes.post("/public/tickets", async (c) => {
  const d = await body<any>(c);

  const ip = c.req.header("CF-Connecting-IP");
  if (!(await verifyTurnstile(c.env, d.turnstileToken, ip))) {
    return c.json({ error: "Anti-bot check failed. Please try again." }, 400);
  }

  const link = await resolveLink(c.env.DB, d.token);
  if (!link) return c.json({ error: "This link is invalid or has expired." }, 404);

  const contactName = String(d.contactName ?? "").trim();
  const contactInfo = String(d.contactInfo ?? "").trim();
  if (!contactName || contactName.length > 200) return c.json({ error: "A valid contact name is required." }, 400);
  if (!contactInfo || contactInfo.length > 200) return c.json({ error: "Valid contact details are required." }, 400);

  // 需求 #1 — product is now a required questionnaire item.
  const product = d.productId
    ? await first<{ id: string }>(
        c.env.DB,
        "SELECT id FROM products WHERE id=? AND status='ACTIVE'",
        String(d.productId)
      )
    : null;
  if (!product) return c.json({ error: "Please select a product." }, 400);
  const productId: string = product.id;

  const fields = await all<TicketFieldRow>(
    c.env.DB,
    "SELECT id, label, fieldType, options, required FROM ticketFields ORDER BY sortOrder, label"
  );
  const validated = validateAnswers(fields, d.answers);
  if (!validated.ok) return c.json({ error: validated.error }, 400);

  const date = new Date().toISOString().slice(0, 10);
  const { seq, ticketNo } = await nextTicketNumber(c.env, date);
  await c.env.DB.prepare(
    `INSERT INTO tickets (id, ticketNo, seq, status, customerCompany, orderNo, contactName, contactInfo, productId, answers, assignedSalesId, assignedServiceId, linkId)
     VALUES (?, ?, ?, 'NEW', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id("tkt"),
      ticketNo,
      seq,
      link.customerCompany,
      link.orderNo,
      contactName,
      contactInfo,
      productId,
      JSON.stringify(validated.answers),
      link.assignedSalesId,
      link.assignedServiceId,
      link.id
    )
    .run();

  // 需求4 (方案A) hook point — when the company backend contract is ready,
  // enqueue this ticket: enqueueOutbox(c.env.DB, "TICKET", ticketNo, {...}).
  // TODO: enqueueOutbox(...).

  return c.json({ ticketNo });
});
