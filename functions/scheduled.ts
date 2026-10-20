import type { Env } from "./lib/types";

// Hourly janitor, run by the Worker's scheduled() handler (src/worker.ts,
// cron in wrangler.toml). Purges DRAFT PIs untouched for 3 days. Approved
// Chinese PIs are kept permanently — they are never archived or deleted.
export async function runJanitor(env: Env) {
  await env.DB.batch([
    env.DB.prepare(`
      DELETE FROM piItems
      WHERE piId IN (
        SELECT id FROM pi
        WHERE status = 'DRAFT'
          AND updatedAt < datetime('now', '-3 days')
      )
    `),
    env.DB.prepare(`
      DELETE FROM piReviewEvents
      WHERE piId IN (
        SELECT id FROM pi
        WHERE status = 'DRAFT'
          AND updatedAt < datetime('now', '-3 days')
      )
    `),
    env.DB.prepare(`
      DELETE FROM pi
      WHERE status = 'DRAFT'
        AND updatedAt < datetime('now', '-3 days')
    `)
  ]);

  // 需求4 (方案A) — integrationOutbox consumer is intentionally not implemented
  // this phase. When the company backend contract is ready, read PENDING rows
  // here, POST to env.INTERNAL_PUSH_URL with env.INTERNAL_PUSH_KEY, and mark
  // each row SENT / FAILED (incrementing attempts + lastError). See lib/outbox.ts.
  // TODO: drain integrationOutbox.
}
