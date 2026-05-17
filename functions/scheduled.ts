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
  return new Response("ok");
};
