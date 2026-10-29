import { all, first, id, parseSqlTime, sqlTime } from "../db";
import type { RequestClaim } from "../ticketWorkflow";
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
// This module is the only writer of feishuDrafts and feishuDraftItems
// (CONTEXT.md "Ticket request lifecycle").
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
  // When ticketId was set to 'CREATING' (see claimRequest).
  claimedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
  expiredAt: string | null;
  dismissedAt: string | null;
};

// Who a request belongs to, as stored in feishuDrafts.requestedBy.
export type FeishuPerson = { unionId: string; openId: string };
export const requesterKey = (p: FeishuPerson) => p.unionId || p.openId;
export const ownsDraft = (draft: Pick<DraftRow, "requestedBy">, p: FeishuPerson) =>
  Boolean(draft.requestedBy) && (draft.requestedBy === p.unionId || draft.requestedBy === p.openId);

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

const markExpired = (db: D1Database, draftId: string, now: Date) =>
  db.prepare("UPDATE feishuDrafts SET expiredAt = ? WHERE id = ? AND expiredAt IS NULL").bind(sqlTime(now), draftId).run();

export async function expireDraft(env: Env, draft: DraftRow, now: Date) {
  await markExpired(env.DB, draft.id, now);
  if (draft.cardMessageId) {
    await updateCard(env, draft.cardMessageId, draft.targetTicketId ? addExpiredCard() : expiredDraftCard()).catch((error) =>
      console.error("Could not grey out an expired request", error)
    );
  }
}

// Why a button on a request is refused; the caller says so in its own words.
// An Add to ticket past its (shorter) limit is "additionExpired".
export type RequestRefusal = "gone" | "created" | "discarded" | "unclaimed" | "notYours" | "inPrivate" | "expired" | "additionExpired";

// The request a button refers to, if it is still open and belongs to this
// person; otherwise why not. An unclaimed device alert (in the after-sales
// group) may only be opened. A request found past its time limit is recorded
// as expired here.
export async function openRequestFor(
  db: D1Database,
  draftId: string,
  person: FeishuPerson,
  cardMessageId: string | null,
  now: Date,
  opts: { allowUnclaimedAlert?: boolean } = {}
): Promise<{ draft: DraftRow } | { refused: RequestRefusal }> {
  const draft = await loadDraft(db, draftId);
  if (!draft) return { refused: "gone" };
  // A claim left behind by a Worker that stopped is no ticket: the request is open again.
  if (draft.ticketId && !isClaimLeftBehind(draft, now)) return { refused: "created" };
  if (draft.dismissedAt) return { refused: "discarded" };
  if (!draft.requestedBy) {
    if (draft.kind === "DEVICE_ALERT" && opts.allowUnclaimedAlert) return { draft };
    return { refused: "unclaimed" };
  }
  if (!ownsDraft(draft, person)) return { refused: "notYours" };
  // The device alert card in the group, after it was taken: the work is in private.
  if (draft.kind === "DEVICE_ALERT" && draft.cardMessageId && cardMessageId && cardMessageId !== draft.cardMessageId) return { refused: "inPrivate" };
  if (isDraftExpired(draft, now)) {
    await markExpired(db, draft.id, now);
    return { refused: draft.targetTicketId ? "additionExpired" : "expired" };
  }
  return { draft };
}

export async function dismissRequest(db: D1Database, draftId: string, now: Date) {
  await db.prepare("UPDATE feishuDrafts SET dismissedAt = ? WHERE id = ?").bind(sqlTime(now), draftId).run();
}

// The card the request is shown on (none when sending it failed).
export async function setRequestCard(db: D1Database, draftId: string, cardMessageId: string | null | undefined) {
  await db.prepare("UPDATE feishuDrafts SET cardMessageId = ? WHERE id = ?").bind(cardMessageId || null, draftId).run();
}

// Forwarded from a group the bot is in: offered as the group to notify (the first one found).
export async function suggestChat(db: D1Database, draftId: string, chatId: string) {
  await db.prepare("UPDATE feishuDrafts SET suggestedChatId = ? WHERE id = ? AND suggestedChatId IS NULL").bind(chatId, draftId).run();
}

export async function markFormOpened(db: D1Database, draftId: string, now: Date) {
  await db.prepare("UPDATE feishuDrafts SET formOpenedAt = ? WHERE id = ?").bind(sqlTime(now), draftId).run();
}

// A known SN found in the material, kept on the request.
export async function keepSerialNumber(db: D1Database, draftId: string, serialNumber: string) {
  await db.prepare("UPDATE feishuDrafts SET serialNumber = ? WHERE id = ?").bind(serialNumber, draftId).run();
}

export async function saveTranscript(db: D1Database, itemId: string, text: string) {
  await db.prepare("UPDATE feishuDraftItems SET text = ? WHERE id = ?").bind(text, itemId).run();
}

// The AI's suggestion, and which items it looked at (null fields when it made none).
export async function saveAiSuggestion(
  db: D1Database,
  draftId: string,
  suggestion: { summary?: string | null; digest?: string | null; ticketType?: string | null; faultType?: string | null } | null,
  itemIds: string[]
) {
  await db
    .prepare("UPDATE feishuDrafts SET aiSummary = ?, aiDigest = ?, aiTicketType = ?, aiFaultType = ?, aiItemIds = ? WHERE id = ?")
    .bind(suggestion?.summary ?? null, suggestion?.digest ?? null, suggestion?.ticketType ?? null, suggestion?.faultType ?? null, JSON.stringify(itemIds), draftId)
    .run();
}

// ── Claims: one ticket (or one saved note) per request ──────────────────────
// Before its ticket is made the request is claimed (ticketId = 'CREATING',
// claimedAt), so two presses make one ticket. The ticket workflow links the
// request to its ticket in the same batch that makes it, and only while the
// claim is still this one. A failed attempt releases the claim; a claim older
// than CLAIM_STALE_MINUTES was left by a Worker that stopped half-way (no
// ticket was made), and the next press may take it again.

export const CLAIM_STALE_MINUTES = 2;
const claimCutoff = (now: Date) => sqlTime(new Date(now.getTime() - CLAIM_STALE_MINUTES * 60 * 1000));

export function isClaimLeftBehind(draft: Pick<DraftRow, "ticketId" | "claimedAt">, now: Date): boolean {
  return draft.ticketId === "CREATING" && (!draft.claimedAt || draft.claimedAt < claimCutoff(now));
}

async function claimRequest(db: D1Database, draftId: string, now: Date): Promise<RequestClaim | null> {
  const claimedAt = sqlTime(now);
  const res = await db
    .prepare(
      `UPDATE feishuDrafts SET ticketId = 'CREATING', claimedAt = ? WHERE id = ?
         AND (ticketId IS NULL OR (ticketId = 'CREATING' AND (claimedAt IS NULL OR claimedAt < ?)))`
    )
    .bind(claimedAt, draftId, claimCutoff(now))
    .run();
  return res.meta?.changes ? { requestId: draftId, claimedAt } : null;
}

// Gives the request back, unless someone has since taken it over.
async function releaseClaim(db: D1Database, claim: RequestClaim) {
  await db
    .prepare("UPDATE feishuDrafts SET ticketId = NULL, claimedAt = NULL WHERE id = ? AND ticketId = 'CREATING' AND claimedAt = ?")
    .bind(claim.requestId, claim.claimedAt)
    .run();
}

// Links the request after `run`, in case it did not (it normally links in its own batch).
async function linkClaim(db: D1Database, claim: RequestClaim, ticketId: string) {
  await db
    .prepare("UPDATE feishuDrafts SET ticketId = ?, claimedAt = NULL WHERE id = ? AND ticketId = 'CREATING' AND claimedAt = ?")
    .bind(ticketId, claim.requestId, claim.claimedAt)
    .run();
}

// Turns the request into a ticket: `create` gets the claim to pass to the
// Ticket workflow. null when the request is already claimed or made.
export async function createTicketFromRequest<T extends { id: string }>(
  db: D1Database,
  draftId: string,
  create: (claim: RequestClaim) => Promise<T>,
  now = new Date()
): Promise<T | null> {
  const claim = await claimRequest(db, draftId, now);
  if (!claim) return null;
  const created = await create(claim).catch(async (error) => {
    await releaseClaim(db, claim);
    throw error;
  });
  await linkClaim(db, claim, created.id);
  return created;
}

// "Save to ticket" for Add to ticket, claimed the same way: `save` gets the
// claim to pass with the note. null when it is already claimed or saved.
export async function saveToTicket<T>(
  db: D1Database,
  draft: Pick<DraftRow, "id" | "targetTicketId">,
  save: (claim: RequestClaim) => Promise<T>,
  now = new Date()
): Promise<T | null> {
  const claim = await claimRequest(db, draft.id, now);
  if (!claim) return null;
  const saved = await save(claim).catch(async (error) => {
    await releaseClaim(db, claim);
    throw error;
  });
  await linkClaim(db, claim, draft.targetTicketId!);
  return saved;
}

// A device alert in the after-sales group: a request nobody has claimed yet,
// with no source chat, so no customer receipt is sent. Its card (sent by
// `send`) and the device's link to it are written together.
export async function openDeviceAlert(
  db: D1Database,
  alert: { draftId: string; serialNumber: string; text: string },
  send: () => Promise<string | null | undefined>,
  now: Date
) {
  await db
    .prepare("INSERT INTO feishuDrafts (id, requestedBy, sourceChatId, sourceMessageId, text, kind, serialNumber) VALUES (?, '', '', '', ?, 'DEVICE_ALERT', ?)")
    .bind(alert.draftId, alert.text, alert.serialNumber)
    .run();
  const messageId = await send();
  await db.batch([
    db.prepare("UPDATE feishuDrafts SET cardMessageId = ? WHERE id = ?").bind(messageId || null, alert.draftId),
    db.prepare("UPDATE deviceStatus SET alertDraftId = ?, updatedAt = ? WHERE serialNumber = ?").bind(alert.draftId, sqlTime(now), alert.serialNumber)
  ]);
}

// "Create ticket" on a device alert: it becomes the presser's open request,
// unless they already have one or someone else took the alert first.
export type AlertClaim = "taken" | "busy" | "takenByOther";

export async function claimAlert(db: D1Database, draftId: string, requestedBy: string, now: Date): Promise<AlertClaim> {
  if (await openDraftOf(db, requestedBy)) return "busy";
  try {
    const res = await db.prepare("UPDATE feishuDrafts SET requestedBy = ?, updatedAt = ? WHERE id = ? AND requestedBy = ''").bind(requestedBy, sqlTime(now), draftId).run();
    return res.meta?.changes ? "taken" : "takenByOther";
  } catch {
    return "busy"; // another request of theirs opened meanwhile (one open request each)
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
