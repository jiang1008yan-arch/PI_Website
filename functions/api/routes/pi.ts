import { all, first, id } from "../../lib/db";
import { nextPiNumber } from "../../lib/piNumber";
import { objectUrl } from "../../lib/r2";
import type { Language } from "../../lib/types";
import { admin, body, createApp } from "./_shared";

export const piRoutes = createApp();

piRoutes.get("/pi/review-queue", async (c) => {
  admin(c);
  return c.json(
    await all(
      c.env.DB,
      "SELECT pi.*, users.displayName as createdByName, reviewer.displayName as assignedToName FROM pi LEFT JOIN users ON users.id=pi.createdById LEFT JOIN users reviewer ON reviewer.id=pi.assignedToId WHERE pi.language='ZH' AND pi.status='PENDING_REVIEW' AND pi.archivedAt IS NULL AND (pi.assignedToId IS NULL OR pi.assignedToId = ?) ORDER BY pi.updatedAt DESC",
      c.get("user").id
    )
  );
});

piRoutes.get("/pi", async (c) => {
  await purgeExpiredDrafts(c.env.DB);
  const user = c.get("user");
  const includeArchived = c.req.query("includeArchived") === "1" && user.role === "ADMIN";
  const where = [includeArchived ? "1=1" : "archivedAt IS NULL"];
  const params: unknown[] = [];
  if (user.role !== "ADMIN") {
    where.push("createdById = ?");
    params.push(user.id);
  }
  return c.json(
    await all(c.env.DB, `SELECT * FROM pi WHERE ${where.join(" AND ")} ORDER BY updatedAt DESC`, ...params)
  );
});

piRoutes.delete("/pi/:id", async (c) => {
  const row = await first<any>(c.env.DB, "SELECT * FROM pi WHERE id=?", c.req.param("id"));
  if (!row) return c.json({ error: "Not found" }, 404);
  if (row.language !== "EN" && row.status !== "DRAFT") {
    return c.json({ error: "Only draft Chinese PIs can be deleted" }, 400);
  }
  if (c.get("user").role !== "ADMIN" && row.createdById !== c.get("user").id) {
    return c.json({ error: "Forbidden" }, 403);
  }
  await deletePi(c.env.DB, row.id);
  return c.json({ ok: true });
});

piRoutes.get("/pi/:id", async (c) => {
  const row = await first<any>(c.env.DB, "SELECT * FROM pi WHERE id=?", c.req.param("id"));
  if (!row) return c.json({ error: "Not found" }, 404);
  if (c.get("user").role !== "ADMIN" && row.createdById !== c.get("user").id) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const items = await all(
    c.env.DB,
    "SELECT piItems.*, products.code, products.nameEn, products.nameZh FROM piItems LEFT JOIN products ON products.id=piItems.productId WHERE piId=? ORDER BY sortOrder",
    row.id
  );
  const events = await all(
    c.env.DB,
    "SELECT piReviewEvents.*, users.displayName as actorName FROM piReviewEvents LEFT JOIN users ON users.id=piReviewEvents.actorId WHERE piId=? ORDER BY createdAt",
    row.id
  );
  return c.json({ pi: row, items, events });
});

piRoutes.post("/pi", async (c) => {
  const d = await body<any>(c);
  const language: Language = d.language === "ZH" ? "ZH" : "EN";
  const date = d.date || new Date().toISOString().slice(0, 10);
  const piId = id("pi");
  const { seq, piNo: generatedPiNo } = await nextPiNumber(c.env, language, date);
  const piNo = String(d.piNo ?? "").trim() || generatedPiNo;
  const duplicate = await first(c.env.DB, "SELECT id FROM pi WHERE piNo=?", piNo);
  if (duplicate) return c.json({ error: "PI No. already exists" }, 400);
  await c.env.DB.prepare(
    `INSERT INTO pi (id, language, piNo, seq, status, date, customerCompany, customerContact, customerEmail, customerPhone, customerCountry, customerAddress, validUntil, incoterm, shipmentMode, paymentTerm, productionOrderNo, customerSource, customerType, deliveryDate, senderCorp, senderAddress, senderFrom, senderPhone, senderEmail, otherRequirements, createdById)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      piId,
      language,
      piNo,
      seq,
      d.status ?? "DRAFT",
      date,
      d.customerCompany || "Draft Customer",
      d.customerContact ?? "",
      d.customerEmail ?? "",
      d.customerPhone ?? "",
      d.customerCountry ?? "",
      d.customerAddress ?? "",
      d.validUntil ?? "",
      d.incoterm ?? "",
      d.shipmentMode ?? "",
      d.paymentTerm ?? "",
      d.productionOrderNo ?? "",
      d.customerSource ?? "",
      d.customerType ?? "",
      d.deliveryDate ?? "",
      d.senderCorp ?? "",
      d.senderAddress ?? "",
      d.senderFrom ?? "",
      d.senderPhone ?? "",
      d.senderEmail ?? "",
      d.otherRequirements ?? "",
      c.get("user").id
    )
    .run();
  await saveItems(c.env.DB, piId, d.items ?? []);
  return c.json({ id: piId, piNo });
});

piRoutes.patch("/pi/:id", async (c) => {
  const d = await body<any>(c);
  const row = await first<any>(c.env.DB, "SELECT * FROM pi WHERE id=?", c.req.param("id"));
  if (!row) return c.json({ error: "Not found" }, 404);
  if (c.get("user").role !== "ADMIN" && row.createdById !== c.get("user").id) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const canEditPendingZh =
    row.language === "ZH" && row.status === "PENDING_REVIEW" && c.get("user").role === "ADMIN";
  if (row.language !== "EN" && !["DRAFT", "REJECTED"].includes(row.status) && !canEditPendingZh) {
    return c.json({ error: "PI is locked" }, 400);
  }
  const piNo = String(d.piNo ?? row.piNo).trim() || row.piNo;
  const duplicate = await first(c.env.DB, "SELECT id FROM pi WHERE piNo=? AND id<>?", piNo, row.id);
  if (duplicate) return c.json({ error: "PI No. already exists" }, 400);
  await c.env.DB.prepare(
    `UPDATE pi SET piNo=?, status=?, date=?, customerCompany=?, customerContact=?, customerEmail=?, customerPhone=?, customerCountry=?, customerAddress=?, validUntil=?, incoterm=?, shipmentMode=?, paymentTerm=?, productionOrderNo=?, customerSource=?, customerType=?, deliveryDate=?, senderCorp=?, senderAddress=?, senderFrom=?, senderPhone=?, senderEmail=?, otherRequirements=?, updatedAt=CURRENT_TIMESTAMP WHERE id=?`
  )
    .bind(
      piNo,
      d.status ?? row.status,
      d.date ?? row.date,
      d.customerCompany ?? row.customerCompany,
      d.customerContact ?? "",
      d.customerEmail ?? "",
      d.customerPhone ?? "",
      d.customerCountry ?? "",
      d.customerAddress ?? "",
      d.validUntil ?? "",
      d.incoterm ?? "",
      d.shipmentMode ?? "",
      d.paymentTerm ?? "",
      d.productionOrderNo ?? "",
      d.customerSource ?? "",
      d.customerType ?? "",
      d.deliveryDate ?? "",
      d.senderCorp ?? "",
      d.senderAddress ?? "",
      d.senderFrom ?? "",
      d.senderPhone ?? "",
      d.senderEmail ?? "",
      d.otherRequirements ?? "",
      row.id
    )
    .run();
  await c.env.DB.prepare("DELETE FROM piItems WHERE piId=?").bind(row.id).run();
  await saveItems(c.env.DB, row.id, d.items ?? []);
  return c.json({ ok: true });
});

piRoutes.post("/pi/:id/submit", async (c) => {
  const row = await first<any>(c.env.DB, "SELECT * FROM pi WHERE id=?", c.req.param("id"));
  if (!row || row.language !== "EN") return c.json({ error: "English PI not found" }, 404);
  if (row.createdById !== c.get("user").id && c.get("user").role !== "ADMIN") {
    return c.json({ error: "Forbidden" }, 403);
  }
  await c.env.DB.prepare("UPDATE pi SET status='SUBMITTED', updatedAt=CURRENT_TIMESTAMP WHERE id=?").bind(row.id).run();
  return c.json({ ok: true });
});

piRoutes.post("/pi/:id/submit-for-review", async (c) => {
  const d = await body<any>(c).catch(() => ({}));
  const row = await first<any>(c.env.DB, "SELECT * FROM pi WHERE id=?", c.req.param("id"));
  if (!row || row.language !== "ZH") return c.json({ error: "Chinese PI not found" }, 404);
  if (row.createdById !== c.get("user").id && c.get("user").role !== "ADMIN") {
    return c.json({ error: "Forbidden" }, 403);
  }
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        "UPDATE pi SET status='PENDING_REVIEW', assignedToId=?, rejectionNote=NULL, updatedAt=CURRENT_TIMESTAMP WHERE id=?"
      )
      .bind(d.assignedToId ?? null, row.id),
    c.env.DB
      .prepare("INSERT INTO piReviewEvents (id, piId, actorId, action) VALUES (?, ?, ?, 'SUBMITTED')")
      .bind(id("evt"), row.id, c.get("user").id)
  ]);
  return c.json({ ok: true });
});

piRoutes.post("/pi/:id/approve", async (c) => {
  admin(c);
  const row = await first<any>(c.env.DB, "SELECT * FROM pi WHERE id=?", c.req.param("id"));
  if (!row || row.language !== "ZH" || row.status !== "PENDING_REVIEW") {
    return c.json({ error: "PI is not pending review" }, 400);
  }
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE pi SET status='APPROVED', updatedAt=CURRENT_TIMESTAMP WHERE id=?").bind(row.id),
    c.env.DB
      .prepare("INSERT INTO piReviewEvents (id, piId, actorId, action) VALUES (?, ?, ?, 'APPROVED')")
      .bind(id("evt"), row.id, c.get("user").id)
  ]);
  return c.json({ ok: true });
});

piRoutes.post("/pi/:id/reject", async (c) => {
  admin(c);
  const d = await body<any>(c);
  const row = await first<any>(c.env.DB, "SELECT * FROM pi WHERE id=?", c.req.param("id"));
  if (!row || row.language !== "ZH" || row.status !== "PENDING_REVIEW") {
    return c.json({ error: "PI is not pending review" }, 400);
  }
  await c.env.DB.batch([
    c.env.DB
      .prepare("UPDATE pi SET status='REJECTED', rejectionNote=?, updatedAt=CURRENT_TIMESTAMP WHERE id=?")
      .bind(d.note ?? "", row.id),
    c.env.DB
      .prepare("INSERT INTO piReviewEvents (id, piId, actorId, action, note) VALUES (?, ?, ?, 'REJECTED', ?)")
      .bind(id("evt"), row.id, c.get("user").id, d.note ?? "")
  ]);
  return c.json({ ok: true });
});

piRoutes.get("/pi/:id/export-bundle", async (c) => {
  const row = await first<any>(c.env.DB, "SELECT * FROM pi WHERE id=?", c.req.param("id"));
  if (!row) return c.json({ error: "Not found" }, 404);
  const user = c.get("user");
  if (row.language === "ZH" && user.role !== "ADMIN") {
    return c.json({ error: "Chinese PIs can only be exported by admins" }, 403);
  }
  if (row.language === "ZH" && row.status !== "APPROVED") {
    return c.json({ error: "Chinese PI must be confirmed before export" }, 403);
  }
  if (row.language === "EN" && user.role !== "ADMIN" && row.createdById !== user.id) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const items = await all<any>(
    c.env.DB,
    "SELECT piItems.*, products.code, products.nameEn, products.nameZh FROM piItems LEFT JOIN products ON products.id=piItems.productId WHERE piId=? ORDER BY sortOrder",
    row.id
  );
  const sender = await first(c.env.DB, "SELECT * FROM senderProfile WHERE id=1");
  const template = await first<any>(c.env.DB, "SELECT * FROM excelTemplates WHERE language=?", row.language);
  const templateRows = await all<any>(
    c.env.DB,
    "SELECT productId, r2Key FROM productTemplates WHERE language=?",
    row.language
  );
  const urls: Record<string, string> = {};
  for (const tpl of templateRows) urls[tpl.productId] = objectUrl(tpl.r2Key);
  return c.json({
    pi: row,
    items,
    sender,
    excelTemplateUrl: template ? objectUrl(template.r2Key) : null,
    anchorCellName: template?.anchorCellName ?? "PRODUCTS_START",
    productTemplateUrls: urls
  });
});

async function saveItems(db: D1Database, piId: string, items: any[]) {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    await db
      .prepare(
        "INSERT INTO piItems (id, piId, productId, quantity, unitPrice, discountPct, fieldValues, sortOrder) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        id("itm"),
        piId,
        it.productId,
        Number(it.quantity ?? 1),
        Number(it.unitPrice ?? 0),
        Number(it.discountPct ?? 0),
        JSON.stringify(it.fieldValues ?? []),
        i
      )
      .run();
  }
}

async function purgeExpiredDrafts(db: D1Database) {
  const rows = await all<{ id: string }>(
    db,
    "SELECT id FROM pi WHERE status='DRAFT' AND updatedAt < datetime('now', '-3 days')"
  );
  for (const row of rows) await deletePi(db, row.id);
}

async function deletePi(db: D1Database, piId: string) {
  await db.batch([
    db.prepare("DELETE FROM piItems WHERE piId=?").bind(piId),
    db.prepare("DELETE FROM piReviewEvents WHERE piId=?").bind(piId),
    db.prepare("DELETE FROM pi WHERE id=?").bind(piId)
  ]);
}
