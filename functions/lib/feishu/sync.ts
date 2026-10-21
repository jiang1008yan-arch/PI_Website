import type { Context } from "hono";
import { all, first } from "../db";
import { enqueueOutbox, markOutbox, OUTBOX_MAX_ATTEMPTS } from "../outbox";
import type { Env } from "../types";
import { handedOverCard, STATUS_TEXT, ticketCard, type TicketCardData } from "./cards";
import { feishuTarget, linkedAdminTargets, type FeishuIds } from "./identity";
import { addBitableRecord, feishuEnabled, replyText, sendCard, sendText, updateCard } from "./client";
import { parsePoolUrl, poolRecordFields, POOL_URL_OPTION_KEY } from "./requirementPool";

// Keeps Feishu in step with tickets (docs/adr/0002-feishu-as-after-sales-work-surface.md):
// - whoever owns a ticket works it: its card is sent privately to the
//   after-sales owner and refreshed in place after every change, from the
//   portal or from Feishu; a hand-over moves it to the new owner. The group is
//   not told about every ticket (it gets a weekly summary instead);
// - the ticket's sales person is told about changes in a private message;
// - the customer's group gets only a receipt when the ticket is created and a
//   notice when it is resolved — nothing internal;
// - repeat faults raise an alert in the internal group;
// - a new owner is told privately that the ticket is now theirs;
// - a ticket that becomes a product request is written once to the product
//   managers' Bitable requirement pool.
// Every push goes through the outbox, so a failed delivery is retried.

export type TicketChange =
  | { kind: "created" }
  | { kind: "status"; to: string }
  | { kind: "note" }
  | { kind: "taken" }
  | { kind: "product" }
  | { kind: "fault"; repeat: { count: number; windowDays: number } | null }
  | { kind: "type"; ticketType: string; toPool: boolean }
  | { kind: "assigned"; newOwnerIds: string[] };

type Payload = { channel: "feishu"; ticketId: string; change: TicketChange };

// Called by routes after a ticket changed: queue the push and try it after the
// response is sent. No-op unless the Feishu bot is configured.
export function afterTicketChange(c: Context, ticketId: string, change: TicketChange) {
  const env = c.env as Env;
  if (!feishuEnabled(env)) return;
  const task = pushTicketChange(env, ticketId, change).catch((error) => console.error("Feishu push failed", error));
  try {
    c.executionCtx.waitUntil(task);
  } catch {
    void task;
  }
}

export async function pushTicketChange(env: Env, ticketId: string, change: TicketChange) {
  const payload: Payload = { channel: "feishu", ticketId, change };
  const rowId = await enqueueOutbox(env.DB, "TICKET", ticketId, payload);
  await deliverRow(env, rowId, payload);
}

async function deliverRow(env: Env, rowId: string, payload: Payload) {
  try {
    await deliver(env, payload);
    await markOutbox(env.DB, rowId, { ok: true });
  } catch (error) {
    await markOutbox(env.DB, rowId, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

// Retries failed or stuck Feishu pushes (scheduled job).
export async function drainFeishuOutbox(env: Env) {
  if (!feishuEnabled(env)) return;
  const rows = await all<{ id: string; payload: string }>(
    env.DB,
    `SELECT id, payload FROM integrationOutbox
     WHERE eventType = 'TICKET' AND status IN ('PENDING', 'FAILED') AND attempts < ?
       AND json_extract(payload, '$.channel') = 'feishu'
     ORDER BY createdAt LIMIT 50`,
    OUTBOX_MAX_ATTEMPTS
  );
  for (const row of rows) await deliverRow(env, row.id, JSON.parse(row.payload));
}

type TicketRow = TicketCardData & {
  assignedServiceId: string | null;
  serviceUnionId: string | null;
  serviceOpenId: string | null;
  feishuCardOwnerId: string | null;
  createdAt: string;
  summary: string | null;
  bitableRecordId: string | null;
  firstNote: string | null;
  feishuCardMessageId: string | null;
  feishuSourceChatId: string | null;
  feishuSourceMessageId: string | null;
  salesUnionId: string | null;
  salesOpenId: string | null;
};

export async function loadTicketForCard(db: D1Database, ticketId: string): Promise<TicketRow | null> {
  const t = await first<TicketRow>(
    db,
    `SELECT t.id, t.ticketNo, t.status, t.ticketType, t.customerCompany, t.orderNo, t.contactName, t.productModel, t.serialNumber, t.faultType,
            t.createdAt, t.summary, t.bitableRecordId, t.feishuCardMessageId, t.feishuSourceChatId, t.feishuSourceMessageId,
            t.assignedServiceId, t.feishuCardOwnerId, service.feishuUnionId AS serviceUnionId, service.feishuOpenId AS serviceOpenId,
            p.nameEn AS productName, service.displayName AS serviceName, sales.displayName AS salesName,
            sales.feishuUnionId AS salesUnionId, sales.feishuOpenId AS salesOpenId,
            (SELECT note FROM ticketUpdates u WHERE u.ticketId = t.id AND u.kind = 'NOTE' AND u.isSystem = 0 AND u.note <> '' ORDER BY u.createdAt DESC, u.rowid DESC LIMIT 1) AS latestNote,
            (SELECT note FROM ticketUpdates u WHERE u.ticketId = t.id AND u.kind = 'NOTE' ORDER BY u.createdAt, u.rowid LIMIT 1) AS firstNote
     FROM tickets t
     LEFT JOIN products p ON p.id = t.productId
     LEFT JOIN users service ON service.id = t.assignedServiceId
     LEFT JOIN users sales ON sales.id = t.assignedSalesId
     WHERE t.id = ?`,
    ticketId
  );
  return t;
}

async function deliver(env: Env, payload: Payload) {
  const t = await loadTicketForCard(env.DB, payload.ticketId);
  if (!t) return;
  const change = payload.change;
  const card = ticketCard({ ...t, repeat: change.kind === "fault" ? change.repeat : null }, env.APP_BASE_URL ?? null);

  // 1. The owner's card, in their private chat with the bot: refreshed in
  // place; after a hand-over the old card says so and the new owner gets one.
  if (t.feishuCardMessageId && t.feishuCardOwnerId === t.assignedServiceId) {
    await updateCard(env, t.feishuCardMessageId, card);
  } else {
    if (t.feishuCardMessageId) await updateCard(env, t.feishuCardMessageId, handedOverCard(t.ticketNo, t.serviceName));
    const owner = feishuTarget({ feishuUnionId: t.serviceUnionId, feishuOpenId: t.serviceOpenId });
    const cardMessageId = owner ? await sendCard(env, owner.type, owner.id, card) : null;
    await env.DB.prepare("UPDATE tickets SET feishuCardMessageId=?, feishuCardOwnerId=? WHERE id=?")
      .bind(cardMessageId, cardMessageId ? t.assignedServiceId : null, t.id)
      .run();
    // An owner who cannot be reached in Feishu: tell the linked admins once,
    // when the ticket gets that owner.
    if (!owner && t.assignedServiceId && (change.kind === "created" || change.kind === "assigned" || change.kind === "taken")) {
      const text = `${t.ticketNo} (${t.customerCompany || "—"}) is assigned to ${t.serviceName ?? "an after-sales user"}, who has not linked Feishu, so they did not get the ticket card. Please let them know, or add their Feishu mobile in Permission Management.${env.APP_BASE_URL ? ` ${env.APP_BASE_URL}/tickets/${t.id}` : ""}`;
      for (const admin of await linkedAdminTargets(env.DB)) await sendText(env, admin.type, admin.id, text);
    }
  }

  // 2. Tell the sales person what changed, privately.
  const sales = feishuTarget({ feishuUnionId: t.salesUnionId, feishuOpenId: t.salesOpenId });
  if (sales && change.kind !== "created") {
    await sendText(env, sales.type, sales.id, `${t.ticketNo} (${t.customerCompany || "—"}): ${describe(change, t)}`);
  }

  // 3. The customer's group: receipt on creation, notice on resolution.
  if (t.feishuSourceChatId) {
    if (change.kind === "created") {
      const text = `Ticket ${t.ticketNo} registered. Our after-sales team will follow up.`;
      if (t.feishuSourceMessageId) await replyText(env, t.feishuSourceMessageId, text);
      else await sendText(env, "chat_id", t.feishuSourceChatId, text);
    } else if (change.kind === "status" && change.to === "RESOLVED") {
      await sendText(env, "chat_id", t.feishuSourceChatId, `Ticket ${t.ticketNo} has been resolved. Please tell us if the issue comes back.`);
    }
  }

  // 4. A new sales owner hears privately that the ticket is now theirs (a new
  // after-sales owner gets the card itself, above).
  const newSalesOwners = change.kind === "assigned" ? change.newOwnerIds.filter((ownerId) => ownerId !== t.assignedServiceId) : [];
  if (newSalesOwners.length) {
    const owners = await all<FeishuIds>(
      env.DB,
      `SELECT feishuUnionId, feishuOpenId FROM users WHERE id IN (${newSalesOwners.map(() => "?").join(",")})`,
      ...newSalesOwners
    );
    const link = env.APP_BASE_URL ? ` ${env.APP_BASE_URL}/tickets/${t.id}` : "";
    for (const o of owners) {
      const target = feishuTarget(o);
      if (target) await sendText(env, target.type, target.id, `You are now responsible for ticket ${t.ticketNo} (${t.customerCompany || "—"}).${link}`);
    }
  }

  // 5. Product requests go to the requirement pool, once.
  if (change.kind === "type" && change.toPool && !t.bitableRecordId) {
    const pool = await first<{ value: string }>(env.DB, "SELECT value FROM appOptions WHERE optionKey = ? LIMIT 1", POOL_URL_OPTION_KEY);
    const target = pool ? parsePoolUrl(pool.value) : null;
    if (target) {
      const recordId = await addBitableRecord(env, target.appToken, target.tableId, poolRecordFields(t, env.APP_BASE_URL ?? null));
      await env.DB.prepare("UPDATE tickets SET bitableRecordId=? WHERE id=?").bind(recordId || "unknown", t.id).run();
    }
  }

  // 6. Repeat faults alert the whole after-sales group.
  if (change.kind === "fault" && change.repeat) {
    await sendText(
      env,
      "chat_id",
      env.FEISHU_SERVICE_CHAT_ID!,
      `Repeat fault: ${t.productName ?? "a product"} has had "${t.faultType}" ${change.repeat.count} times in ${change.repeat.windowDays} days (latest ${t.ticketNo}).`
    );
  }
}

const TICKET_TYPE_LABEL: Record<string, string> = { FAULT: "Fault", PRODUCT_REQUEST: "Product request", OTHER: "Question / other" };

function describe(change: TicketChange, t: TicketRow): string {
  switch (change.kind) {
    case "status":
      return `status is now ${STATUS_TEXT[change.to as keyof typeof STATUS_TEXT] ?? change.to}.`;
    case "note":
      return `new note: ${t.latestNote ?? ""}`;
    case "taken":
      return `taken by ${t.serviceName ?? "after-sales"}.`;
    case "fault":
      return `fault type confirmed: ${t.faultType}.`;
    case "product":
      return "product line updated.";
    case "type":
      return `type is now ${TICKET_TYPE_LABEL[change.ticketType] ?? change.ticketType}.`;
    case "assigned":
      return `after-sales owner: ${t.serviceName ?? "unassigned"}.`;
    default:
      return "updated.";
  }
}
