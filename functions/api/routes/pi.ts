import { all, first, id } from "../../lib/db";
import { nextPiNumber } from "../../lib/piNumber";
import {
  canApprovePi,
  canDeletePi,
  canExportPi,
  canPatchPi,
  canReadPi,
  canRejectPi,
  canSubmitForReview,
  canSubmitPi,
  type PiRow,
  type Verdict
} from "../../lib/piAccess";
import { objectUrl } from "../../lib/r2";
import type { Language } from "../../lib/types";
import {
  EDITABLE_HEADER_COLUMN_SET,
  planApprove,
  planDelete,
  planReject,
  planSubmit,
  planSubmitForReview,
  runTransition
} from "../../lib/piWorkflow";
import { admin, body, createApp } from "./_shared";
import type { Context } from "hono";

export const piRoutes = createApp();

function deny(c: Context, verdict: Verdict) {
  if (verdict.allowed) return undefined;
  return c.json({ error: verdict.reason }, verdict.status);
}

type PiRowFull = PiRow & Record<string, any>;

async function loadPi(c: Context): Promise<PiRowFull | null> {
  return await first<PiRowFull>(c.env.DB, "SELECT * FROM pi WHERE id=?", c.req.param("id"));
}

async function loadPiItems(db: D1Database, piId: string) {
  return await all(db, "SELECT * FROM piItems WHERE piId=? ORDER BY sortOrder", piId);
}

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
  const row = await loadPi(c);
  if (!row) return c.json({ error: "Not found" }, 404);
  const denied = deny(c, canDeletePi(c.get("user"), row));
  if (denied) return denied;
  await runTransition(c.env.DB, row.id, planDelete(row), c.get("user").id);
  return c.json({ ok: true });
});

piRoutes.get("/pi/:id", async (c) => {
  const row = await loadPi(c);
  if (!row) return c.json({ error: "Not found" }, 404);
  const denied = deny(c, canReadPi(c.get("user"), row));
  if (denied) return denied;
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
    VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      piId,
      language,
      piNo,
      seq,
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
  const row = await loadPi(c);
  if (!row) return c.json({ error: "Not found" }, 404);
  const denied = deny(c, canPatchPi(c.get("user"), row));
  if (denied) return denied;
  const piNo = String(d.piNo ?? row.piNo).trim() || row.piNo;
  const duplicate = await first(c.env.DB, "SELECT id FROM pi WHERE piNo=? AND id<>?", piNo, row.id);
  if (duplicate) return c.json({ error: "PI No. already exists" }, 400);
  // PATCH only touches header columns. status, rejectionNote, assignedToId,
  // submittedSnapshot are workflow-owned and silently ignored here.
  await updatePiHeader(c.env.DB, row.id, { ...d, piNo });
  await replaceItems(c.env.DB, row.id, d.items ?? []);
  return c.json({ ok: true });
});

piRoutes.post("/pi/:id/submit", async (c) => {
  const row = await loadPi(c);
  if (!row) return c.json({ error: "English PI not found" }, 404);
  const denied = deny(c, canSubmitPi(c.get("user"), row));
  if (denied) return denied;
  await runTransition(c.env.DB, row.id, planSubmit(row), c.get("user").id);
  return c.json({ ok: true });
});

piRoutes.post("/pi/:id/submit-for-review", async (c) => {
  const d = await body<any>(c).catch(() => ({}));
  const row = await loadPi(c);
  if (!row) return c.json({ error: "Chinese PI not found" }, 404);
  const denied = deny(c, canSubmitForReview(c.get("user"), row));
  if (denied) return denied;
  const items = await loadPiItems(c.env.DB, row.id);
  await runTransition(
    c.env.DB,
    row.id,
    planSubmitForReview(row, items, { assignedToId: d.assignedToId ?? null }),
    c.get("user").id
  );
  return c.json({ ok: true });
});

piRoutes.post("/pi/:id/approve", async (c) => {
  const d = await body<any>(c).catch(() => ({}));
  const row = await loadPi(c);
  if (!row) return c.json({ error: "Not found" }, 404);
  const denied = deny(c, canApprovePi(c.get("user"), row));
  if (denied) return denied;
  await runTransition(
    c.env.DB,
    row.id,
    planApprove(row, { pi: d.pi, items: d.items }),
    c.get("user").id
  );
  return c.json({ ok: true });
});

piRoutes.post("/pi/:id/reject", async (c) => {
  const d = await body<any>(c);
  const row = await loadPi(c);
  if (!row) return c.json({ error: "Not found" }, 404);
  const denied = deny(c, canRejectPi(c.get("user"), row));
  if (denied) return denied;
  await runTransition(c.env.DB, row.id, planReject(row, { note: d.note }), c.get("user").id);
  return c.json({ ok: true });
});

piRoutes.get("/pi/:id/export-bundle", async (c) => {
  const row = await loadPi(c);
  if (!row) return c.json({ error: "Not found" }, 404);
  const denied = deny(c, canExportPi(c.get("user"), row));
  if (denied) return denied;
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

async function updatePiHeader(db: D1Database, piId: string, d: Record<string, unknown>) {
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const key of Object.keys(d)) {
    if (!EDITABLE_HEADER_COLUMN_SET.has(key)) continue;
    sets.push(`${key}=?`);
    binds.push(d[key] ?? "");
  }
  if (!sets.length) return;
  sets.push("updatedAt=CURRENT_TIMESTAMP");
  binds.push(piId);
  await db.prepare(`UPDATE pi SET ${sets.join(", ")} WHERE id=?`).bind(...binds).run();
}

function itemInsertStatements(db: D1Database, piId: string, items: any[]) {
  if (!items.length) return [];
  const insert = db.prepare(
    "INSERT INTO piItems (id, piId, productId, quantity, unitPrice, discountPct, fieldValues, sortOrder) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  return items.map((it: any, i: number) =>
    insert.bind(
      id("itm"),
      piId,
      it.productId,
      Number(it.quantity ?? 1),
      Number(it.unitPrice ?? 0),
      Number(it.discountPct ?? 0),
      JSON.stringify(it.fieldValues ?? []),
      i
    )
  );
}

async function saveItems(db: D1Database, piId: string, items: any[]) {
  const stmts = itemInsertStatements(db, piId, items);
  if (stmts.length) await db.batch(stmts);
}

async function replaceItems(db: D1Database, piId: string, items: any[]) {
  await db.batch([
    db.prepare("DELETE FROM piItems WHERE piId=?").bind(piId),
    ...itemInsertStatements(db, piId, items)
  ]);
}

async function purgeExpiredDrafts(db: D1Database) {
  const rows = await all<{ id: string }>(
    db,
    "SELECT id FROM pi WHERE status='DRAFT' AND updatedAt < datetime('now', '-3 days')"
  );
  for (const row of rows) {
    await runTransition(db, row.id, planDelete({ id: row.id } as PiRow), "");
  }
}
