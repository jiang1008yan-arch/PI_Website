import type { Context } from "hono";
import { all, first } from "../db";
import { enqueueOutbox, markOutbox, OUTBOX_MAX_ATTEMPTS } from "../outbox";
import type { Env } from "../types";
import { STATUS_TEXT, ticketCard, type TicketCardData } from "./cards";
import { feishuEnabled, replyText, sendCard, sendText, updateCard } from "./client";

// Keeps Feishu in step with tickets (docs/adr/0002-feishu-as-after-sales-work-surface.md):
// - the internal after-sales group has one card per ticket, refreshed in place
//   after every change, from the portal or from Feishu;
// - the ticket's sales person is @-mentioned under that card on changes;
// - the customer's group gets only a receipt when the ticket is created and a
//   notice when it is resolved — nothing internal;
// - repeat faults raise an alert in the internal group.
// Every push goes through the outbox, so a failed delivery is retried.

export type TicketChange =
  | { kind: "created" }
  | { kind: "status"; to: string }
  | { kind: "note" }
  | { kind: "taken" }
  | { kind: "product" }
  | { kind: "fault"; repeat: { count: number; windowDays: number } | null };

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
  feishuCardMessageId: string | null;
  feishuSourceChatId: string | null;
  feishuSourceMessageId: string | null;
  salesOpenId: string | null;
};

export async function loadTicketForCard(db: D1Database, ticketId: string): Promise<TicketRow | null> {
  const t = await first<TicketRow>(
    db,
    `SELECT t.id, t.ticketNo, t.status, t.customerCompany, t.orderNo, t.contactName, t.productModel, t.serialNumber, t.faultType,
            t.feishuCardMessageId, t.feishuSourceChatId, t.feishuSourceMessageId,
            p.nameEn AS productName, service.displayName AS serviceName, sales.displayName AS salesName, sales.feishuOpenId AS salesOpenId,
            (SELECT note FROM ticketUpdates u WHERE u.ticketId = t.id AND u.kind = 'NOTE' ORDER BY u.createdAt DESC, u.rowid DESC LIMIT 1) AS latestNote
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

  // 1. The internal card: create it once, then refresh it in place.
  let cardMessageId = t.feishuCardMessageId;
  if (cardMessageId) {
    await updateCard(env, cardMessageId, card);
  } else {
    cardMessageId = await sendCard(env, "chat_id", env.FEISHU_SERVICE_CHAT_ID!, card);
    await env.DB.prepare("UPDATE tickets SET feishuCardMessageId=? WHERE id=?").bind(cardMessageId, t.id).run();
  }

  // 2. Tell the sales person what changed, under the card.
  if (t.salesOpenId && change.kind !== "created") {
    await replyText(env, cardMessageId, `<at user_id="${t.salesOpenId}"></at> ${t.ticketNo}: ${describe(change, t)}`);
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

  // 4. Repeat faults alert the whole after-sales group.
  if (change.kind === "fault" && change.repeat) {
    await sendText(
      env,
      "chat_id",
      env.FEISHU_SERVICE_CHAT_ID!,
      `Repeat fault: ${t.productName ?? "a product"} has had "${t.faultType}" ${change.repeat.count} times in ${change.repeat.windowDays} days (latest ${t.ticketNo}).`
    );
  }
}

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
    default:
      return "updated.";
  }
}
