import { id } from "./db";

// Outbox for pushes to external systems: a row is written first, then
// delivered; failed rows are retried by the scheduled job.
//
// In use: TICKET rows whose payload has `channel: "feishu"` drive the Feishu
// bot (lib/feishu/sync.ts) — card refreshes, @-mentions, receipts, alerts.
//
// Still reserved (需求4, 方案A): pushes to the company backend (PI_ZH, and
// TICKET without a channel). Their payload contract is not finalized, so those
// hook points carry a `// TODO` and nothing enqueues them yet. When the
// contract is ready: set INTERNAL_PUSH_URL / INTERNAL_PUSH_KEY, add a channel,
// and deliver it in the scheduled consumer.

export type OutboxEventType = "TICKET" | "PI_ZH";

// Payload contract for the company backend (draft — confirm before enqueuing):
//   TICKET: { ticketNo, status, customerCompany, orderNo, answers, createdAt }
//   PI_ZH:  { piNo, status, customerCompany, items: [...], approvedAt }
export type OutboxPayload = Record<string, unknown>;

export const OUTBOX_MAX_ATTEMPTS = 5;

export async function enqueueOutbox(
  db: D1Database,
  eventType: OutboxEventType,
  refId: string,
  payload: OutboxPayload
): Promise<string> {
  const rowId = id("obx");
  await db
    .prepare(
      "INSERT INTO integrationOutbox (id, eventType, refId, payload, status, attempts) VALUES (?, ?, ?, ?, 'PENDING', 0)"
    )
    .bind(rowId, eventType, refId, JSON.stringify(payload))
    .run();
  return rowId;
}

export async function markOutbox(db: D1Database, rowId: string, result: { ok: true } | { ok: false; error: string }) {
  if (result.ok) {
    await db.prepare("UPDATE integrationOutbox SET status='SENT', sentAt=CURRENT_TIMESTAMP, attempts=attempts+1, lastError=NULL WHERE id=?").bind(rowId).run();
  } else {
    await db
      .prepare("UPDATE integrationOutbox SET status='FAILED', attempts=attempts+1, lastError=? WHERE id=?")
      .bind(result.error.slice(0, 1000), rowId)
      .run();
  }
}
