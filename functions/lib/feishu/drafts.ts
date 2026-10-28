import { all, first, id } from "../db";
import type { Env } from "../types";
import { addExpiredCard, expiredDraftCard } from "./cards";
import { downloadResource, updateCard } from "./client";
import type { Material, MaterialKind } from "./materials";

// A ticket request collected in the bot's private chat
// (docs/plans/2026-10-27-feishu-collect-and-similar-tickets.md): each person
// has at most one open request; everything they send the bot goes into it until
// they create the ticket or discard it. A request expires six hours after
// material was last added; after that the next message starts a new one.
// "Add to ticket" works the same way for an existing ticket (targetTicketId),
// with a shorter limit, since it is started from the ticket on purpose.
export const DRAFT_TTL_HOURS = 6;
export const ADD_TTL_MINUTES = 30;

// Files bigger than this are listed but not saved ("view it in Feishu").
export const MAX_MATERIAL_BYTES = 50 * 1024 * 1024;

export type DraftRow = {
  id: string;
  requestedBy: string;
  kind: "MESSAGE" | "DEVICE_ALERT";
  text: string;
  serialNumber: string | null;
  aiSummary: string | null;
  aiTicketType: string | null;
  aiFaultType: string | null;
  aiDigest: string | null;
  aiItemIds: string | null;
  ticketId: string | null;
  cardMessageId: string | null;
  suggestedChatId: string | null;
  // "Add to ticket": the material goes onto this existing ticket.
  targetTicketId: string | null;
  formOpenedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
  expiredAt: string | null;
  dismissedAt: string | null;
};

// Why a file could not be kept.
export type ItemProblem = "IN_FORWARD" | "TOO_LARGE" | "DOWNLOAD_FAILED";

export type DraftItem = {
  id: string;
  draftId: string;
  sourceMessageId: string;
  kind: MaterialKind;
  text: string | null;
  fileName: string | null;
  contentType: string | null;
  size: number | null;
  durationMs: number | null;
  r2Key: string | null;
  problem: ItemProblem | null;
  position: string;
};

// SQLite's CURRENT_TIMESTAMP format, in UTC.
const parseSqlTime = (value: string) => new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
export const sqlTime = (date: Date) => date.toISOString().slice(0, 19).replace("T", " ");

// Device alerts stay open until someone acts on them.
export function isDraftExpired(
  draft: { createdAt: string; updatedAt?: string | null; expiredAt?: string | null; kind?: string | null; targetTicketId?: string | null },
  now: Date
): boolean {
  if (draft.kind === "DEVICE_ALERT") return false;
  if (draft.expiredAt) return true;
  const limit = draft.targetTicketId ? ADD_TTL_MINUTES * 60 * 1000 : DRAFT_TTL_HOURS * 60 * 60 * 1000;
  return now.getTime() - parseSqlTime(draft.updatedAt || draft.createdAt).getTime() > limit;
}

const OPEN = "ticketId IS NULL AND expiredAt IS NULL AND dismissedAt IS NULL";

export async function loadDraft(db: D1Database, draftId: string): Promise<DraftRow | null> {
  return await first<DraftRow>(db, "SELECT * FROM feishuDrafts WHERE id = ?", draftId);
}

export async function openDraftOf(db: D1Database, requestedBy: string): Promise<DraftRow | null> {
  return await first<DraftRow>(db, `SELECT * FROM feishuDrafts WHERE requestedBy = ? AND ${OPEN}`, requestedBy);
}

// The person's open request, or a new one. Messages forwarded one by one
// arrive at the same time; the unique index keeps them in a single request.
// An open request past its time limit is closed first (its card greyed out).
export async function getOrOpenDraft(env: Env, requestedBy: string, now: Date): Promise<{ draft: DraftRow; created: boolean }> {
  const open = await openDraftOf(env.DB, requestedBy);
  if (open && !isDraftExpired(open, now)) return { draft: open, created: false };
  if (open) await expireDraft(env, open, now);
  const newId = id("fdr");
  await env.DB.prepare(
    "INSERT OR IGNORE INTO feishuDrafts (id, requestedBy, sourceChatId, sourceMessageId, text, updatedAt) VALUES (?, ?, '', '', '', ?)"
  )
    .bind(newId, requestedBy, sqlTime(now))
    .run();
  const draft = (await openDraftOf(env.DB, requestedBy))!;
  return { draft, created: draft.id === newId };
}

// Starts "Add to ticket" for this person, unless something is already open
// (then that is returned, and nothing is started).
export async function openAddition(env: Env, requestedBy: string, ticketId: string, now: Date): Promise<{ draft: DraftRow; created: boolean }> {
  const open = await openDraftOf(env.DB, requestedBy);
  if (open && !isDraftExpired(open, now)) return { draft: open, created: false };
  if (open) await expireDraft(env, open, now);
  const newId = id("fdr");
  await env.DB.prepare(
    "INSERT OR IGNORE INTO feishuDrafts (id, requestedBy, sourceChatId, sourceMessageId, text, updatedAt, targetTicketId) VALUES (?, ?, '', '', '', ?, ?)"
  )
    .bind(newId, requestedBy, sqlTime(now), ticketId)
    .run();
  const draft = (await openDraftOf(env.DB, requestedBy))!;
  return { draft, created: draft.id === newId };
}

export async function expireDraft(env: Env, draft: DraftRow, now: Date) {
  await env.DB.prepare("UPDATE feishuDrafts SET expiredAt = ? WHERE id = ? AND expiredAt IS NULL").bind(sqlTime(now), draft.id).run();
  if (draft.cardMessageId) {
    await updateCard(env, draft.cardMessageId, draft.targetTicketId ? addExpiredCard() : expiredDraftCard()).catch((error) =>
      console.error("Could not grey out an expired request", error)
    );
  }
}

export async function loadItems(db: D1Database, draftId: string): Promise<DraftItem[]> {
  return await all<DraftItem>(db, "SELECT * FROM feishuDraftItems WHERE draftId = ? ORDER BY position, rowid", draftId);
}

const r2KeyFor = (draftId: string, itemId: string) => `feishu-drafts/${draftId}/${itemId}`;

// Store a message's material on the request: texts as they are, files
// downloaded to R2. `position` is the message's arrival time, so messages
// forwarded one by one stay in order whichever event is handled first.
export async function addMaterials(env: Env, draftId: string, materials: Material[], position: string, now: Date): Promise<DraftItem[]> {
  const added: DraftItem[] = [];
  for (const [index, m] of materials.entries()) {
    const item: DraftItem = {
      id: id("fdi"),
      draftId,
      sourceMessageId: m.sourceMessageId,
      kind: m.kind,
      text: m.text?.slice(0, 4000) ?? null,
      fileName: m.fileName?.replace(/[\\/\r\n]/g, "_").slice(0, 200) ?? null,
      contentType: null,
      size: null,
      durationMs: m.durationMs ?? null,
      r2Key: null,
      problem: null,
      position: `${position}#${String(index).padStart(3, "0")}`
    };
    if (m.fileKey && m.resourceType) {
      if (m.insideForward) item.problem = "IN_FORWARD";
      else {
        const file = await downloadResource(env, m.sourceMessageId, m.fileKey, m.resourceType, MAX_MATERIAL_BYTES).catch((error) => ({
          ok: false as const,
          tooLarge: false,
          size: null,
          error: String(error)
        }));
        if (file.ok) {
          item.r2Key = r2KeyFor(draftId, item.id);
          item.contentType = file.contentType;
          item.size = file.body.byteLength;
          await env.FILES.put(item.r2Key, file.body, { httpMetadata: { contentType: file.contentType } });
        } else {
          item.problem = file.tooLarge ? "TOO_LARGE" : "DOWNLOAD_FAILED";
          item.size = file.size;
          if (!file.tooLarge) console.error("Could not download a Feishu file", file.error);
        }
      }
    }
    await env.DB.prepare(
      `INSERT INTO feishuDraftItems (id, draftId, sourceMessageId, kind, text, fileName, contentType, size, durationMs, r2Key, problem, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(item.id, draftId, item.sourceMessageId, item.kind, item.text, item.fileName, item.contentType, item.size, item.durationMs, item.r2Key, item.problem, item.position)
      .run();
    added.push(item);
  }
  await refreshDraftText(env.DB, draftId, now);
  return added;
}

export async function removeItem(env: Env, draftId: string, itemId: string, now: Date): Promise<boolean> {
  const item = await first<DraftItem>(env.DB, "SELECT * FROM feishuDraftItems WHERE id = ? AND draftId = ?", itemId, draftId);
  if (!item) return false;
  if (item.r2Key) await env.FILES.delete(item.r2Key);
  await env.DB.prepare("DELETE FROM feishuDraftItems WHERE id = ?").bind(item.id).run();
  await refreshDraftText(env.DB, draftId, now);
  return true;
}

const seconds = (ms: number | null) => (ms ? ` ${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}` : "");

// One line per item, as it goes on the ticket's timeline and to the AI.
export function itemLine(item: Pick<DraftItem, "kind" | "text" | "fileName" | "durationMs">): string {
  switch (item.kind) {
    case "TEXT":
      return item.text ?? "";
    case "AUDIO":
      return `[Voice message${seconds(item.durationMs)}]${item.text ? ` ${item.text}` : ""}`;
    case "IMAGE":
      return "[Picture]";
    case "VIDEO":
      return `[Video${seconds(item.durationMs)}]`;
    default:
      return `[File${item.fileName ? `: ${item.fileName}` : ""}]`;
  }
}

export function compileDraftText(items: Pick<DraftItem, "kind" | "text" | "fileName" | "durationMs">[]): string {
  return items.map(itemLine).filter(Boolean).join("\n").slice(0, 4000);
}

// Keeps feishuDrafts.text (what the ticket's first note and older code read)
// in step with the items, and counts the change as activity.
export async function refreshDraftText(db: D1Database, draftId: string, now: Date) {
  const text = compileDraftText(await loadItems(db, draftId));
  await db.prepare("UPDATE feishuDrafts SET text = ?, updatedAt = ? WHERE id = ?").bind(text, sqlTime(now), draftId).run();
}

// Scheduled: grey out the cards of requests left alone past the limit.
export async function expireStaleDrafts(env: Env, now: Date): Promise<number> {
  const cutoff = sqlTime(new Date(now.getTime() - DRAFT_TTL_HOURS * 60 * 60 * 1000));
  const addCutoff = sqlTime(new Date(now.getTime() - ADD_TTL_MINUTES * 60 * 1000));
  const stale = await all<DraftRow>(
    env.DB,
    `SELECT * FROM feishuDrafts WHERE kind = 'MESSAGE' AND ${OPEN}
       AND COALESCE(updatedAt, createdAt) < CASE WHEN targetTicketId IS NULL THEN ? ELSE ? END LIMIT 100`,
    cutoff,
    addCutoff
  );
  for (const draft of stale) await expireDraft(env, draft, now);
  return stale.length;
}

// Scheduled: files of requests that were discarded or expired are deleted
// (files of created tickets became ticket attachments and stay).
export async function purgeAbandonedDraftFiles(env: Env): Promise<number> {
  const items = await all<{ id: string; r2Key: string | null }>(
    env.DB,
    `SELECT i.id, i.r2Key FROM feishuDraftItems i JOIN feishuDrafts d ON d.id = i.draftId
     WHERE d.ticketId IS NULL AND (d.dismissedAt IS NOT NULL OR d.expiredAt IS NOT NULL) LIMIT 200`
  );
  if (!items.length) return 0;
  const keys = items.map((i) => i.r2Key).filter((k): k is string => Boolean(k));
  if (keys.length) await env.FILES.delete(keys);
  await env.DB.batch(items.map((i) => env.DB.prepare("DELETE FROM feishuDraftItems WHERE id = ?").bind(i.id)));
  return items.length;
}
