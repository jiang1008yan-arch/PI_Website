import { all } from "../db";
import type { Env } from "../types";
import { expiredDraftCard } from "./cards";
import { updateCard } from "./client";

// A Feishu ticket request (the question card, then the form) is valid for six
// hours; after that it is greyed out and the person has to @ the bot again.
export const DRAFT_TTL_HOURS = 6;

// SQLite's CURRENT_TIMESTAMP format, in UTC.
const parseSqlTime = (value: string) => new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);

// Device alerts stay open until someone acts on them.
export function isDraftExpired(draft: { createdAt: string; expiredAt?: string | null; kind?: string | null }, now: Date): boolean {
  if (draft.kind === "DEVICE_ALERT") return false;
  if (draft.expiredAt) return true;
  return now.getTime() - parseSqlTime(draft.createdAt).getTime() > DRAFT_TTL_HOURS * 60 * 60 * 1000;
}

const sqlTime = (date: Date) => date.toISOString().slice(0, 19).replace("T", " ");

// Scheduled: grey out the cards of requests left unanswered past the limit.
export async function expireStaleDrafts(env: Env, now: Date): Promise<number> {
  const cutoff = sqlTime(new Date(now.getTime() - DRAFT_TTL_HOURS * 60 * 60 * 1000));
  const stale = await all<{ id: string; cardMessageId: string | null }>(
    env.DB,
    "SELECT id, cardMessageId FROM feishuDrafts WHERE kind = 'MESSAGE' AND ticketId IS NULL AND expiredAt IS NULL AND createdAt < ? LIMIT 100",
    cutoff
  );
  for (const draft of stale) {
    if (draft.cardMessageId) await updateCard(env, draft.cardMessageId, expiredDraftCard()).catch((error) => console.error("Could not grey out an expired request", error));
    await env.DB.prepare("UPDATE feishuDrafts SET expiredAt = ? WHERE id = ?").bind(sqlTime(now), draft.id).run();
  }
  return stale.length;
}
