import { all, first, id } from "../../lib/db";
import { nextPiNumber } from "../../lib/piNumber";
import { buildLinkedZhItems } from "../../lib/piLink";
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
import { piItemInsertStatements, piItemReplaceStatements } from "../../lib/piItems";
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

function parseFieldValues(raw: string | null | undefined): any[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
  const where = [includeArchived ? "1=1" : "pi.archivedAt IS NULL"];
  const params: unknown[] = [];
  if (user.role !== "ADMIN") {
    where.push("pi.createdById = ?");
    params.push(user.id);
  }
  // Expose the linked counterpart's PI No so a linked ZH draft can display the
  // English PI No as its name (需求1).
  return c.json(
    await all(
      c.env.DB,
      `SELECT pi.*, linked.piNo AS linkedPiNo FROM pi LEFT JOIN pi linked ON linked.id = pi.linkedPiId
       WHERE ${where.join(" AND ")} ORDER BY pi.updatedAt DESC`,
      ...params
    )
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
  const linkedPiNo = row.linkedPiId
    ? (await first<{ piNo: string }>(c.env.DB, "SELECT piNo FROM pi WHERE id=?", row.linkedPiId))?.piNo ?? null
    : null;
  return c.json({ pi: { ...row, linkedPiNo }, items, events });
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

  // 需求1 — first creation of a standalone EN PI also spins up a linked ZH
  // DRAFT (one-time generation, not continuous sync). Idempotent: an EN PI that
  // already carries a linkedPiId is not re-linked.
  if (language === "EN" && !d.linkedPiId) {
    const linked = await createLinkedZhDraft(c, piId, date, d);
    return c.json({ id: piId, piNo, linkedZhId: linked.id, linkedZhPiNo: linked.piNo });
  }

  return c.json({ id: piId, piNo });
});

const SHARED_HEADER_COLUMNS = [
  "customerCompany",
  "customerContact",
  "customerEmail",
  "customerPhone",
  "customerCountry",
  "customerAddress",
  "validUntil",
  "incoterm",
  "shipmentMode",
  "paymentTerm",
  "senderCorp",
  "senderAddress",
  "senderFrom",
  "senderPhone",
  "senderEmail",
  "otherRequirements"
] as const;

async function createLinkedZhDraft(c: Context, enPiId: string, date: string, d: any) {
  const zhId = id("pi");
  const { seq, piNo } = await nextPiNumber(c.env, "ZH", date);
  const shared = SHARED_HEADER_COLUMNS.map((col) => (col === "customerCompany" ? d[col] || "Draft Customer" : d[col] ?? ""));
  await c.env.DB.prepare(
    `INSERT INTO pi (id, language, piNo, seq, status, date, ${SHARED_HEADER_COLUMNS.join(", ")}, createdById, linkedPiId)
    VALUES (?, 'ZH', ?, ?, 'DRAFT', ?, ${SHARED_HEADER_COLUMNS.map(() => "?").join(", ")}, ?, ?)`
  )
    .bind(zhId, piNo, seq, date, ...shared, c.get("user").id, enPiId)
    .run();
  const zhItems = await buildLinkedZhItems(c.env.DB, d.items ?? []);
  await saveItems(c.env.DB, zhId, zhItems);
  await c.env.DB.prepare("UPDATE pi SET linkedPiId=? WHERE id=?").bind(zhId, enPiId).run();
  return { id: zhId, piNo };
}

function linkedDraftInputFromPi(row: PiRowFull, items: any[]) {
  return {
    ...row,
    items: items.map((it) => ({
      ...it,
      fieldValues: parseFieldValues(it.fieldValues)
    }))
  };
}

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
  // 需求4 (方案A) hook point — when the company backend contract is ready,
  // enqueue the approved ZH PI here: enqueueOutbox(c.env.DB, "PI_ZH", row.id, {...}).
  // TODO: enqueueOutbox(...).
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

piRoutes.post("/pi/:id/resync-zh", async (c) => {
  const row = await loadPi(c);
  if (!row) return c.json({ error: "English PI not found" }, 404);
  if (row.language !== "EN") return c.json({ error: "English PI not found" }, 404);
  const denied = deny(c, canPatchPi(c.get("user"), row));
  if (denied) return denied;
  const enItems = await loadPiItems(c.env.DB, row.id);
  if (!row.linkedPiId) {
    const linked = await createLinkedZhDraft(c, row.id, row.date, linkedDraftInputFromPi(row, enItems));
    return c.json({ ok: true, created: true, linkedZhId: linked.id, linkedZhPiNo: linked.piNo });
  }
  const zh = await first<PiRowFull>(c.env.DB, "SELECT * FROM pi WHERE id=?", row.linkedPiId);
  if (!zh) return c.json({ error: "Linked Chinese draft not found" }, 404);
  if (zh.status !== "DRAFT" && zh.status !== "REJECTED") {
    return c.json({ error: "Chinese draft is locked (already submitted or approved)" }, 400);
  }
  // Rebuild only the product rows from the latest EN data; the ZH-specific
  // header fields (production order no, customer source/type, delivery date)
  // the salesperson filled in are left untouched.
  const parsedEnItems = enItems.map((it: any) => ({
    ...it,
    fieldValues: parseFieldValues(it.fieldValues)
  }));
  const zhItems = await buildLinkedZhItems(c.env.DB, parsedEnItems);
  await replaceItems(c.env.DB, zh.id, zhItems);
  await c.env.DB.prepare("UPDATE pi SET updatedAt=CURRENT_TIMESTAMP WHERE id=?").bind(zh.id).run();
  return c.json({ ok: true, created: false, linkedZhId: zh.id, linkedZhPiNo: zh.piNo });
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

async function saveItems(db: D1Database, piId: string, items: any[]) {
  const stmts = piItemInsertStatements(db, piId, items);
  if (stmts.length) await db.batch(stmts);
}

async function replaceItems(db: D1Database, piId: string, items: any[]) {
  await db.batch(piItemReplaceStatements(db, piId, items));
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
