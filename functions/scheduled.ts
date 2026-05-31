import type { Env } from "./lib/types";

export const onScheduled: PagesFunction<Env> = async ({ env }) => {
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

  await env.DB.prepare(`
    UPDATE pi
    SET archivedAt = CURRENT_TIMESTAMP
    WHERE language = 'ZH'
      AND status = 'APPROVED'
      AND archivedAt IS NULL
      AND (
        SELECT MAX(createdAt) FROM piReviewEvents
        WHERE piId = pi.id AND action = 'APPROVED'
      ) < datetime('now', '-14 days')
  `).run();

  await env.DB.batch([
    env.DB.prepare(`
      DELETE FROM piItems
      WHERE piId IN (
        SELECT id FROM pi
        WHERE language = 'ZH'
          AND status = 'APPROVED'
          AND archivedAt IS NOT NULL
      )
    `),
    env.DB.prepare(`
      DELETE FROM piReviewEvents
      WHERE piId IN (
        SELECT id FROM pi
        WHERE language = 'ZH'
          AND status = 'APPROVED'
          AND archivedAt IS NOT NULL
      )
    `),
    env.DB.prepare(`
      DELETE FROM pi
      WHERE language = 'ZH'
        AND status = 'APPROVED'
        AND archivedAt IS NOT NULL
    `)
  ]);

  // 需求4 (方案A) — integrationOutbox consumer is intentionally not implemented
  // this phase. When the company backend contract is ready, read PENDING rows
  // here, POST to env.INTERNAL_PUSH_URL with env.INTERNAL_PUSH_KEY, and mark
  // each row SENT / FAILED (incrementing attempts + lastError). See lib/outbox.ts.
  // TODO: drain integrationOutbox.

  return new Response("ok");
};
