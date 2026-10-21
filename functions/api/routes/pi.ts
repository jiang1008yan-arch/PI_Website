import { all, first, id } from "../../lib/db";
import { nextPiNumber } from "../../lib/piNumber";
import { buildLinkedZhItems } from "../../lib/piLink";
import {
  canAbandonRevision,
  canApprovePi,
  canCommerceDecide,
  canDeletePi,
  canExportPi,
  canPatchPi,
  canReadPi,
  canRejectPi,
  canStartRevision,
  canSubmitForReview,
  canSubmitPi,
  canViewPi,
  type ExportVersion,
  type PiRow,
  type Verdict
} from "../../lib/piAccess";
import { objectUrl } from "../../lib/r2";
import { parseSerials } from "../../lib/devices";
import { canRegisterSn } from "../../lib/ticketAccess";
import { purgeExpired } from "../../scheduled";
import { piItemInsertStatements, piItemReplaceStatements } from "../../lib/piItems";
import type { Language } from "../../lib/types";
import {
  EDITABLE_HEADER_COLUMN_SET,
  parseEffectiveSnapshot,
  planAbandonRevision,
  planApprove,
  planCommerceApprove,
  planCommerceReject,
  planDelete,
  planReject,
  planStartRevision,
  planSubmit,
  planSubmitForReview,
  runTransition,
  WorkflowConflictError,
  type EffectiveSnapshot,
  type TransitionPlan
} from "../../lib/piWorkflow";
import { notifyPiTransition, siteBase, type PiTransition } from "../../lib/feishu/piBot/notifyPi";
import { stepOf } from "../../lib/feishu/piBot/piCard";
import { body, createApp } from "./_shared";
import type { Context } from "hono";

export const piRoutes = createApp();

function deny(c: Context, verdict: Verdict) {
  if (verdict.allowed) return undefined;
  return c.json({ error: verdict.reason }, verdict.status);
}

// Schedule background work that should not delay the response. Prefers
// executionCtx.waitUntil (keeps the worker alive); if the context is absent
// (e.g. under tests), falls back to a detached promise.
function runAfterResponse(c: Context, task: () => Promise<unknown>) {
  try {
    c.executionCtx.waitUntil(task());
  } catch {
    void task();
  }
}

type PiRowFull = PiRow & Record<string, any>;

// Runs an approval-chain transition. Returns a 409 response when someone else
// acted on the PI first (website + Feishu card at once), else null. Once
// committed, the PI Assistant bot tells the next approver / the submitter,
// after the response.
async function approvalTransition(c: Context, row: PiRowFull, plan: TransitionPlan, kind: PiTransition) {
  try {
    await runTransition(c.env.DB, row.id, plan, c.get("user").id);
  } catch (error) {
    if (error instanceof WorkflowConflictError) return c.json({ error: error.message }, 409);
    throw error;
  }
  const args = { piId: row.id, transition: kind, actor: c.get("user"), step: stepOf(row.status), base: siteBase(c.env, c.req.url) };
  runAfterResponse(c, () => notifyPiTransition(c.env, args));
  return null;
}

// The submitter picks the approvers: presales (a PRESALES user, or an admin)
// and commerce (a COMMERCE user). Either may be left out — then any admin
// confirms / any commerce user decides, as before picks existed.
async function approverPickError(db: D1Database, presalesId: string, commerceId: string) {
  const ids = [presalesId, commerceId].filter(Boolean);
  if (!ids.length) return null;
  const rows = await all<{ id: string; role: string }>(
    db,
    `SELECT id, role FROM users WHERE id IN (${ids.map(() => "?").join(",")})`,
    ...ids
  );
  const roleOf = (userId: string) => rows.find((r) => r.id === userId)?.role ?? "";
  if (presalesId && !["PRESALES", "ADMIN"].includes(roleOf(presalesId))) return "The presales approver must be a Presales user or an admin";
  if (commerceId && roleOf(commerceId) !== "COMMERCE") return "The commerce approver must be a Commerce user";
  return null;
}

// Loads the PI row plus, for a linked EN PI, its ZH PI's status and revision
// flag — an EN PI follows its approved ZH PI's lock (see piCapabilities).
async function loadPi(c: Context): Promise<PiRowFull | null> {
  const row = await first<PiRowFull>(c.env.DB, "SELECT * FROM pi WHERE id=?", c.req.param("id"));
  if (row && row.language === "EN" && row.linkedPiId) {
    row.linkedZh = await first<{ status: PiRow["status"]; revisionInProgress: number }>(
      c.env.DB,
      "SELECT status, revisionInProgress FROM pi WHERE id=?",
      row.linkedPiId
    );
  }
  return row;
}

const ITEM_SELECT =
  "SELECT piItems.*, products.code, products.nameEn, products.nameZh FROM piItems LEFT JOIN products ON products.id=piItems.productId WHERE piId=? ORDER BY sortOrder";

// Items of a frozen snapshot, decorated with product names like ITEM_SELECT rows.
async function snapshotItemsWithProducts(db: D1Database, items: EffectiveSnapshot["zh"]["items"]) {
  const ids = Array.from(new Set(items.map((it) => it.productId)));
  const products = ids.length
    ? await all<{ id: string; code: string; nameEn: string; nameZh: string }>(
        db,
        `SELECT id, code, nameEn, nameZh FROM products WHERE id IN (${ids.map(() => "?").join(", ")})`,
        ...ids
      )
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));
  return items.map((it, i) => ({
    ...it,
    fieldValues: JSON.stringify(it.fieldValues ?? []),
    sortOrder: i,
    code: byId.get(it.productId)?.code ?? null,
    nameEn: byId.get(it.productId)?.nameEn ?? null,
    nameZh: byId.get(it.productId)?.nameZh ?? null
  }));
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

// ZH PIs awaiting presales confirmation by the caller: a PRESALES user sees
// those picked for them; an admin sees those picked for them or unassigned.
piRoutes.get("/pi/review-queue", async (c) => {
  const user = c.get("user");
  if (user.role !== "ADMIN" && user.role !== "PRESALES") return c.json({ error: "Forbidden" }, 403);
  const mine = user.role === "ADMIN" ? "(pi.assignedToId IS NULL OR pi.assignedToId = ?)" : "pi.assignedToId = ?";
  return c.json(
    await all(
      c.env.DB,
      `SELECT pi.*, users.displayName as createdByName, reviewer.displayName as assignedToName FROM pi LEFT JOIN users ON users.id=pi.createdById LEFT JOIN users reviewer ON reviewer.id=pi.assignedToId WHERE pi.language='ZH' AND pi.status='PENDING_REVIEW' AND pi.archivedAt IS NULL AND ${mine} ORDER BY pi.updatedAt DESC`,
      user.id
    )
  );
});

// The list view only needs the columns used to render a PI card and to gate
// filtering/ownership — never the heavy ones (submittedSnapshot, the full
// sender/customer detail set). Projecting just these keeps the list payload
// small so the workspace paints quickly (需求1). Line items stay click-to-load
// via GET /pi/:id.
const PI_LIST_COLUMNS = [
  "id",
  "language",
  "status",
  "piNo",
  "productionOrderNo",
  "customerCompany",
  "createdById",
  "assignedToId",
  "linkedPiId",
  "linkedPiNoSnapshot",
  "revisionNo",
  "revisionInProgress",
  "updatedAt"
] as const;

piRoutes.get("/pi", async (c) => {
  // Cleanup of 3-day-idle drafts must not block first paint of the list. Run it
  // after the response is sent (waitUntil keeps the worker alive for it); fall
  // back to a fire-and-forget if no execution context is available.
  runAfterResponse(c, () => purgeExpiredDrafts(c.env.DB));
  const user = c.get("user");
  const includeArchived = c.req.query("includeArchived") === "1" && user.role === "ADMIN";
  const where = [includeArchived ? "1=1" : "pi.archivedAt IS NULL"];
  const params: unknown[] = [];
  // Filter by language server-side so each workspace only fetches its own half
  // of the list instead of pulling both and discarding one on the client (需求1).
  const language = c.req.query("language");
  if (language === "EN" || language === "ZH") {
    where.push("pi.language = ?");
    params.push(language);
  }
  if (user.role !== "ADMIN") {
    where.push("pi.createdById = ?");
    params.push(user.id);
  }
  // The workspace lists work in progress only; approved ZH PIs live in the
  // searchable approved list (GET /pi/approved).
  where.push("NOT (pi.language = 'ZH' AND pi.status = 'APPROVED')");
  // Expose the linked counterpart's PI No so a linked ZH draft can display the
  // English PI No as its name (需求1).
  const cols = PI_LIST_COLUMNS.map((col) => `pi.${col}`).join(", ");
  return c.json(
    await all(
      c.env.DB,
      `SELECT ${cols}, COALESCE(linked.piNo, NULLIF(pi.linkedPiNoSnapshot, '')) AS linkedPiNo
       FROM pi LEFT JOIN pi linked ON linked.id = pi.linkedPiId
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

// ── Commerce approval ─────────────────────────────────────────────────────

piRoutes.get("/pi/commerce-queue", async (c) => {
  const user = c.get("user");
  if (user.role !== "COMMERCE" && user.role !== "ADMIN") return c.json({ error: "Forbidden" }, 403);
  return c.json(
    await all(
      c.env.DB,
      `SELECT pi.id, pi.piNo, pi.status, pi.productionOrderNo, pi.customerCompany, pi.linkedPiId, pi.linkedPiNoSnapshot,
              pi.revisionNo, pi.revisionInProgress, pi.updatedAt, linked.piNo AS linkedPiNo, creator.displayName AS createdByName
       FROM pi
       LEFT JOIN pi linked ON linked.id = pi.linkedPiId
       LEFT JOIN users creator ON creator.id = pi.createdById
       WHERE pi.language = 'ZH' AND pi.status = 'PENDING_COMMERCE'
         AND (? = 'ADMIN' OR pi.commerceId IS NULL OR pi.commerceId = ?)
       ORDER BY pi.updatedAt DESC`,
      user.role,
      user.id
    )
  );
});

// ── Approved list (search + paging) ───────────────────────────────────────

const APPROVED_PAGE_SIZE = 50;

piRoutes.get("/pi/approved", async (c) => {
  const user = c.get("user");
  const q = String(c.req.query("q") ?? "").trim().slice(0, 100);
  const offset = Math.max(0, Number(c.req.query("offset") ?? 0) || 0);
  // Sales only ever see their own (created or received); others may narrow to theirs.
  const mine = user.role === "SALES" || c.req.query("scope") === "mine";

  const company = "COALESCE(json_extract(pi.effectiveSnapshot, '$.zh.header.customerCompany'), pi.customerCompany)";
  const orderNo = "COALESCE(json_extract(pi.effectiveSnapshot, '$.zh.header.productionOrderNo'), pi.productionOrderNo)";
  const where = ["pi.language = 'ZH'", "(pi.status = 'APPROVED' OR pi.revisionInProgress = 1)"];
  const params: unknown[] = [];
  if (mine) {
    where.push("(pi.createdById = ? OR pi.assignedToId = ?)");
    params.push(user.id, user.id);
  }
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    where.push(
      `(pi.piNo LIKE ? ESCAPE '\\' OR ${orderNo} LIKE ? ESCAPE '\\' OR ${company} LIKE ? ESCAPE '\\' OR linked.piNo LIKE ? ESCAPE '\\' OR pi.linkedPiNoSnapshot LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM devices d WHERE d.piId = pi.id AND d.serialNumber LIKE ? ESCAPE '\\'))`
    );
    // SNs are stored upper-cased.
    params.push(like, like, like, like, like, like.toUpperCase());
  }
  const rows = await all<any>(
    c.env.DB,
    `SELECT pi.id, pi.piNo, pi.status, pi.revisionNo, pi.revisionInProgress, pi.approvedAt, pi.createdById, pi.assignedToId,
            pi.linkedPiId, pi.linkedPiNoSnapshot, linked.piNo AS linkedPiNo,
            ${company} AS customerCompany, ${orderNo} AS productionOrderNo, creator.displayName AS createdByName
     FROM pi
     LEFT JOIN pi linked ON linked.id = pi.linkedPiId
     LEFT JOIN users creator ON creator.id = pi.createdById
     WHERE ${where.join(" AND ")}
     ORDER BY pi.approvedAt DESC, pi.id DESC
     LIMIT ? OFFSET ?`,
    ...params,
    APPROVED_PAGE_SIZE + 1,
    offset
  );
  return c.json({ items: rows.slice(0, APPROVED_PAGE_SIZE), hasMore: rows.length > APPROVED_PAGE_SIZE });
});

piRoutes.get("/pi/:id", async (c) => {
  const row = await loadPi(c);
  if (!row) return c.json({ error: "Not found" }, 404);
  const denied = deny(c, canReadPi(c.get("user"), row));
  if (denied) return denied;
  const items = await all(c.env.DB, ITEM_SELECT, row.id);
  const events = await loadEvents(c.env.DB, row.id);
  const linked = row.linkedPiId
    ? await first<{ piNo: string; status: string; revisionInProgress: number }>(
        c.env.DB,
        "SELECT piNo, status, revisionInProgress FROM pi WHERE id=?",
        row.linkedPiId
      )
    : null;
  const linkedPiNoSnapshot = String(row.linkedPiNoSnapshot ?? "").trim() || null;
  return c.json({
    pi: {
      ...row,
      linkedPiNo: linked?.piNo ?? linkedPiNoSnapshot,
      linkedPiStatus: linked?.status ?? null,
      linkedPiRevisionInProgress: linked?.revisionInProgress ?? 0
    },
    items,
    events
  });
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

  // The linked ZH draft is created explicitly via POST /pi/:id/resync-zh (the
  // "Sync to Chinese draft" button), never as a side effect of saving — so Save
  // and Sync stay two distinct actions.
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
  const linkedPiNoSnapshot = String(d.piNo ?? "").trim() || null;
  await c.env.DB.prepare(
    `INSERT INTO pi (id, language, piNo, seq, status, date, ${SHARED_HEADER_COLUMNS.join(", ")}, createdById, linkedPiId, linkedPiNoSnapshot)
    VALUES (?, 'ZH', ?, ?, 'DRAFT', ?, ${SHARED_HEADER_COLUMNS.map(() => "?").join(", ")}, ?, ?, ?)`
  )
    .bind(zhId, piNo, seq, date, ...shared, c.get("user").id, enPiId, linkedPiNoSnapshot)
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
  const presalesId = String(d.assignedToId ?? "");
  const commerceId = String(d.commerceId ?? "");
  const pickError = await approverPickError(c.env.DB, presalesId, commerceId);
  if (pickError) return c.json({ error: pickError }, 400);
  const items = await loadPiItems(c.env.DB, row.id);
  const conflict = await approvalTransition(
    c,
    row,
    planSubmitForReview(row, items, { assignedToId: presalesId || null, commerceId: commerceId || null }),
    "SUBMITTED"
  );
  if (conflict) return conflict;
  // One PI, one production order: warn (not block) when another ZH PI already
  // carries this number — older data may legitimately repeat it.
  const orderNo = String(row.productionOrderNo ?? "").trim();
  const duplicates = orderNo
    ? await all<{ piNo: string }>(
        c.env.DB,
        "SELECT piNo FROM pi WHERE language='ZH' AND id<>? AND TRIM(productionOrderNo)=?",
        row.id,
        orderNo
      )
    : [];
  return c.json({ ok: true, duplicateProductionOrderPiNos: duplicates.map((d) => d.piNo) });
});

piRoutes.post("/pi/:id/approve", async (c) => {
  const d = await body<any>(c).catch(() => ({}));
  const row = await loadPi(c);
  if (!row) return c.json({ error: "Not found" }, 404);
  const denied = deny(c, canApprovePi(c.get("user"), row));
  if (denied) return denied;
  const conflict = await approvalTransition(c, row, planApprove(row, { pi: d.pi, items: d.items }), "APPROVED");
  if (conflict) return conflict;
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
  const conflict = await approvalTransition(c, row, planReject(row, { note: d.note }), "REJECTED");
  if (conflict) return conflict;
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
  const version: ExportVersion = c.req.query("version") === "effective" ? "effective" : "current";
  const denied = deny(c, canExportPi(c.get("user"), row, version));
  if (denied) return denied;
  // While a revision is in progress the effective version is the frozen
  // snapshot (on the ZH row, covering its linked EN PI too).
  const effective = version === "effective" ? await effectiveContentFor(c.env.DB, row) : null;
  const items = effective ? effective.items : await all<any>(c.env.DB, ITEM_SELECT, row.id);
  const exportRow = effective ? effective.pi : row;
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
    pi: exportRow,
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
  // Same janitor as the scheduled job (idle drafts and expired approvals).
  await purgeExpired(db, new Date());
}

async function loadEvents(db: D1Database, piId: string) {
  return await all(
    db,
    "SELECT piReviewEvents.*, users.displayName as actorName FROM piReviewEvents LEFT JOIN users ON users.id=piReviewEvents.actorId WHERE piId=? ORDER BY piReviewEvents.createdAt, piReviewEvents.rowid",
    piId
  );
}

// The effective (approved) content of a PI: the frozen snapshot while a
// revision of its ZH PI is in progress, otherwise null (the live row is it).
async function effectiveContentFor(db: D1Database, row: PiRowFull) {
  const zhRow =
    row.language === "ZH"
      ? row
      : row.linkedPiId
        ? await first<PiRowFull>(db, "SELECT * FROM pi WHERE id=?", row.linkedPiId)
        : null;
  if (!zhRow?.revisionInProgress) return null;
  const snapshot = parseEffectiveSnapshot(zhRow.effectiveSnapshot);
  if (!snapshot) return null;
  const part = row.language === "ZH" ? snapshot.zh : snapshot.en;
  if (!part) return null;
  return { pi: { ...row, ...part.header }, items: await snapshotItemsWithProducts(db, part.items) };
}

// ── Commerce approval ─────────────────────────────────────────────────────

piRoutes.post("/pi/:id/commerce-approve", async (c) => {
  const row = await loadPi(c);
  if (!row) return c.json({ error: "Not found" }, 404);
  const denied = deny(c, canCommerceDecide(c.get("user"), row));
  if (denied) return denied;
  const conflict = await approvalTransition(c, row, planCommerceApprove(row, new Date()), "APPROVED");
  if (conflict) return conflict;
  // ERP hook point (not built this phase): once an ERP contract exists, hand the
  // approved ZH/EN pair over here, e.g. enqueueOutbox(c.env.DB, "PI_ZH", row.id, {...}).
  // TODO: ERP hand-off.
  return c.json({ ok: true });
});

piRoutes.post("/pi/:id/commerce-reject", async (c) => {
  const d = await body<any>(c).catch(() => ({}));
  const note = String(d.note ?? "").trim();
  if (!note) return c.json({ error: "A rejection reason is required" }, 400);
  const row = await loadPi(c);
  if (!row) return c.json({ error: "Not found" }, 404);
  const denied = deny(c, canCommerceDecide(c.get("user"), row));
  if (denied) return denied;
  const conflict = await approvalTransition(c, row, planCommerceReject(row, { note }), "REJECTED");
  if (conflict) return conflict;
  return c.json({ ok: true });
});

// ── Revisions ─────────────────────────────────────────────────────────────

piRoutes.post("/pi/:id/revisions", async (c) => {
  const d = await body<any>(c).catch(() => ({}));
  const reason = String(d.reason ?? "").trim().slice(0, 2000);
  if (!reason) return c.json({ error: "A reason for the change is required" }, 400);
  const row = await loadPi(c);
  if (!row) return c.json({ error: "Not found" }, 404);
  const denied = deny(c, canStartRevision(c.get("user"), row));
  if (denied) return denied;
  const zhItems = await loadPiItems(c.env.DB, row.id);
  const enRow = row.linkedPiId ? await first<PiRowFull>(c.env.DB, "SELECT * FROM pi WHERE id=?", row.linkedPiId) : null;
  const en = enRow ? { row: enRow, items: await loadPiItems(c.env.DB, enRow.id) } : null;
  await runTransition(c.env.DB, row.id, planStartRevision(row, zhItems as any[], en as any, reason), c.get("user").id);
  return c.json({ ok: true });
});

piRoutes.post("/pi/:id/revisions/abandon", async (c) => {
  const row = await loadPi(c);
  if (!row) return c.json({ error: "Not found" }, 404);
  const denied = deny(c, canAbandonRevision(c.get("user"), row));
  if (denied) return denied;
  await runTransition(c.env.DB, row.id, planAbandonRevision(row), c.get("user").id);
  return c.json({ ok: true });
});

// ── Read-only detail page ─────────────────────────────────────────────────

piRoutes.get("/pi/:id/view", async (c) => {
  const user = c.get("user");
  const row = await loadPi(c);
  if (!row) return c.json({ error: "Not found" }, 404);
  const denied = deny(c, canViewPi(user, row));
  if (denied) return denied;

  const snapshot = row.revisionInProgress ? parseEffectiveSnapshot(row.effectiveSnapshot) : null;
  const decorate = async (part: { header: Record<string, unknown>; items: any[] } | null | undefined, base: PiRowFull) =>
    part ? { pi: { ...base, ...part.header }, items: await snapshotItemsWithProducts(c.env.DB, part.items) } : null;

  const zhCurrent = { pi: row, items: await all(c.env.DB, ITEM_SELECT, row.id) };
  const zhEffective = snapshot ? await decorate(snapshot.zh, row) : row.status === "APPROVED" ? zhCurrent : null;

  let en: { current: any; effective: any } | null = null;
  if (row.linkedPiId) {
    const enRow = await first<PiRowFull>(c.env.DB, "SELECT * FROM pi WHERE id=?", row.linkedPiId);
    if (enRow) {
      const enCurrent = { pi: enRow, items: await all(c.env.DB, ITEM_SELECT, enRow.id) };
      const enEffective = snapshot?.en ? await decorate(snapshot.en, enRow) : row.status === "APPROVED" ? enCurrent : null;
      en = { current: enCurrent, effective: enEffective };
    }
  }

  return c.json({
    zh: { current: zhCurrent, effective: zhEffective },
    en,
    events: await loadEvents(c.env.DB, row.id),
    revisionNo: row.revisionNo,
    revisionInProgress: Boolean(row.revisionInProgress)
  });
});


// ── Device serial numbers ─────────────────────────────────────────────────

piRoutes.get("/pi/:id/devices", async (c) => {
  const row = await loadPi(c);
  if (!row) return c.json({ error: "Not found" }, 404);
  const denied = deny(c, canViewPi(c.get("user"), row));
  if (denied) return denied;
  return c.json(
    await all(
      c.env.DB,
      `SELECT d.id, d.serialNumber, d.createdAt, u.displayName AS createdByName
       FROM devices d LEFT JOIN users u ON u.id = d.createdById
       WHERE d.piId = ? ORDER BY d.serialNumber`,
      row.id
    )
  );
});

// Registers SNs (pasted, one per line) on an approved ZH PI. An SN already on
// any PI is reported, never moved.
piRoutes.post("/pi/:id/devices", async (c) => {
  const user = c.get("user");
  if (!canRegisterSn(user)) return c.json({ error: "Forbidden" }, 403);
  const row = await loadPi(c);
  if (!row) return c.json({ error: "Not found" }, 404);
  if (row.language !== "ZH" || !(row.status === "APPROVED" || row.revisionInProgress)) {
    return c.json({ error: "Serial numbers can only be registered on approved Chinese PIs" }, 400);
  }
  const d = await body<any>(c).catch(() => ({}));
  const { serials, invalid } = parseSerials(d.serials ?? "");
  if (serials.length > 500) return c.json({ error: "Register at most 500 serial numbers at a time" }, 400);
  const existing = serials.length
    ? await all<{ serialNumber: string; piId: string; piNo: string }>(
        c.env.DB,
        `SELECT d.serialNumber, d.piId, pi.piNo FROM devices d LEFT JOIN pi ON pi.id = d.piId
         WHERE d.serialNumber IN (${serials.map(() => "?").join(", ")})`,
        ...serials
      )
    : [];
  const taken = new Set(existing.map((e) => e.serialNumber));
  const toAdd = serials.filter((sn) => !taken.has(sn));
  if (toAdd.length) {
    await c.env.DB.batch(
      toAdd.map((sn) =>
        c.env.DB.prepare("INSERT INTO devices (id, serialNumber, piId, createdById) VALUES (?, ?, ?, ?)").bind(id("dev"), sn, row.id, user.id)
      )
    );
  }
  return c.json({
    added: toAdd,
    duplicates: existing.map((e) => ({ serialNumber: e.serialNumber, piNo: e.piNo, samePi: e.piId === row.id })),
    invalid
  });
});

piRoutes.delete("/pi/:id/devices/:deviceId", async (c) => {
  if (!canRegisterSn(c.get("user"))) return c.json({ error: "Forbidden" }, 403);
  await c.env.DB.prepare("DELETE FROM devices WHERE id = ? AND piId = ?").bind(c.req.param("deviceId"), c.req.param("id")).run();
  return c.json({ ok: true });
});
