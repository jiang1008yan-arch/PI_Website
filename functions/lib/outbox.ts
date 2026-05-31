import { id } from "./db";

// 需求4 — internal company-backend integration, write-only, reservation only (方案A).
//
// This file defines the outbox row shape and an enqueue helper, but it is NOT
// wired into any flow yet. The receiving backend's payload contract is not
// finalized, so enqueuing now would only accumulate PENDING rows in the wrong
// shape that we'd have to re-clean later. Hook points (ZH PI approve, ticket
// events) carry a `// TODO: enqueueOutbox(...)` comment instead. The consumer
// (read outbox -> POST -> mark SENT) lives in functions/scheduled.ts and is
// likewise left as a TODO for this phase.
//
// When the contract is ready: set INTERNAL_PUSH_URL / INTERNAL_PUSH_KEY via
// wrangler.toml [vars] + secret, fill in the consumer, and uncomment the hooks.

export type OutboxEventType = "TICKET" | "PI_ZH";

// Payload contract (draft — confirm with the company backend before enqueuing):
//   TICKET: { ticketNo, status, customerCompany, orderNo, answers, createdAt }
//   PI_ZH:  { piNo, status, customerCompany, items: [...], approvedAt }
export type OutboxPayload = Record<string, unknown>;

export async function enqueueOutbox(
  db: D1Database,
  eventType: OutboxEventType,
  refId: string,
  payload: OutboxPayload
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO integrationOutbox (id, eventType, refId, payload, status, attempts) VALUES (?, ?, ?, ?, 'PENDING', 0)"
    )
    .bind(id("obx"), eventType, refId, JSON.stringify(payload))
    .run();
}
