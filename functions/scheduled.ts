import type { Env } from "./lib/types";

// Approved ZH PIs are kept for three years after their latest commerce approval
// (after-sales looks them up for the life of the equipment). Draft PIs idle for
// three days are garbage — except revision drafts, which reopen an approved PI,
// and EN drafts paired with a ZH PI that has moved past its own draft.
export const APPROVED_RETENTION_YEARS = 3;
export const DRAFT_IDLE_DAYS = 3;

// SQLite's datetime text format ("YYYY-MM-DD HH:MM:SS"), comparable as a string.
function sqlTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export async function purgeExpired(db: D1Database, now: Date): Promise<void> {
  const draftCutoff = sqlTime(new Date(now.getTime() - DRAFT_IDLE_DAYS * 24 * 60 * 60 * 1000));
  const approvedCutoffDate = new Date(now);
  approvedCutoffDate.setUTCFullYear(approvedCutoffDate.getUTCFullYear() - APPROVED_RETENTION_YEARS);
  const approvedCutoff = sqlTime(approvedCutoffDate);

  const expired = `
    SELECT id FROM pi
    WHERE (status = 'DRAFT' AND revisionInProgress = 0 AND updatedAt < ?1
           -- an EN draft whose linked ZH PI is in review or approved is part of that pair
           AND NOT EXISTS (
             SELECT 1 FROM pi AS zh
             WHERE zh.id = pi.linkedPiId AND zh.language = 'ZH' AND (zh.status <> 'DRAFT' OR zh.revisionInProgress = 1)
           ))
       OR (language = 'ZH' AND status = 'APPROVED' AND revisionInProgress = 0 AND approvedAt IS NOT NULL AND approvedAt < ?2)
  `;
  await db.batch([
    // Keep the deleted PI's number on anything that linked to it.
    db.prepare(`
      UPDATE pi
      SET linkedPiNoSnapshot = COALESCE((SELECT gone.piNo FROM pi AS gone WHERE gone.id = pi.linkedPiId), NULLIF(linkedPiNoSnapshot, '')),
          linkedPiId = NULL
      WHERE linkedPiId IN (${expired})
    `).bind(draftCutoff, approvedCutoff),
    db.prepare(`DELETE FROM piItems WHERE piId IN (${expired})`).bind(draftCutoff, approvedCutoff),
    db.prepare(`DELETE FROM devices WHERE piId IN (${expired})`).bind(draftCutoff, approvedCutoff),
    db.prepare(`DELETE FROM piReviewEvents WHERE piId IN (${expired})`).bind(draftCutoff, approvedCutoff),
    db.prepare(`DELETE FROM pi WHERE id IN (${expired})`).bind(draftCutoff, approvedCutoff)
  ]);
}

export const onScheduled: PagesFunction<Env> = async ({ env }) => {
  await purgeExpired(env.DB, new Date());

  // 需求4 (方案A) — integrationOutbox consumer is intentionally not implemented
  // this phase. When the company backend contract is ready, read PENDING rows
  // here, POST to env.INTERNAL_PUSH_URL with env.INTERNAL_PUSH_KEY, and mark
  // each row SENT / FAILED (incrementing attempts + lastError). See lib/outbox.ts.
  // TODO: drain integrationOutbox.

  return new Response("ok");
};
