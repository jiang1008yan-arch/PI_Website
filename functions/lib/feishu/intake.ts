import { all, first } from "../db";
import { canReadPictures, canTranscribe, toBase64, transcribeAudio, triageMessages, type AiConfig, type AiMedia } from "../aiTriage";
import { findKnownReferences } from "../lookup";
import { findSimilarTickets } from "../similarTickets";
import { canCreateTicket } from "../ticketAccess";
import { FAULT_TYPE_OPTION_KEY } from "../ticketWorkflow";
import type { AppUser, Env } from "../types";
import { loadUserAiConfig } from "../personalAiKey";
import { addCard, bindCard, collectCard, collectedCounts, draftCard, type CardItem, type DraftPrefill } from "./cards";
import { siteBase } from "./piBot/notifyPi";
import { getMessageItems, listBotChats, messageContentToText, sendCard, sendText, serviceChatId, updateCard } from "./client";
import {
  addMaterials,
  compileDraftText,
  getOrOpenDraft,
  keepSerialNumber,
  loadDraft,
  loadItems,
  markFormOpened,
  refreshDraftText,
  requesterKey,
  saveAiSuggestion,
  saveTranscript,
  setRequestCard,
  suggestChat,
  type DraftItem,
  type DraftRow,
  type FeishuPerson
} from "./ticketRequest";
import { feishuTarget, userForFeishu } from "./identity";
import { materialsFromContent, materialsFromForward, type Material } from "./materials";

// Ticket requests through the bot (docs/plans/2026-10-27-feishu-collect-and-similar-tickets.md):
// after-sales and admins send the bot a customer's messages in their private
// chat — merged or forwarded one by one, texts, pictures, voice messages,
// videos, files — and everything goes into their one open request until they
// create the ticket or discard it. "Prepare ticket" runs the AI once and turns
// the card into the form, with earlier tickets like this one.

export const personOf = (ids: any): FeishuPerson => ({ unionId: String(ids?.union_id ?? ""), openId: String(ids?.open_id ?? "") });
export const privateTarget = (p: FeishuPerson) => feishuTarget({ feishuUnionId: p.unionId || null, feishuOpenId: p.openId || null });

// The AI looks at a few pictures at most, each small enough to send inline.
export const AI_MAX_PICTURES = 4;
const AI_MAX_PICTURE_BYTES = 5 * 1024 * 1024;
const AI_MAX_VOICE_BYTES = 7 * 1024 * 1024;
const AI_MAX_VOICE_MESSAGES = 5;

export async function faultTypes(db: D1Database) {
  return (await all<{ value: string }>(db, "SELECT value FROM appOptions WHERE optionKey = ? ORDER BY sortOrder, value", FAULT_TYPE_OPTION_KEY)).map((r) => r.value);
}

export const toCardItems = (items: DraftItem[]): CardItem[] =>
  items.map((i) => ({ id: i.id, kind: i.kind, text: i.text, fileName: i.fileName, durationMs: i.durationMs, problem: i.problem }));

// The card of an open request while material comes in: a new ticket
// request, or "Add to ticket" for an existing one.
export async function collectingCard(env: Env, draft: Pick<DraftRow, "id" | "targetTicketId">, items: DraftItem[]) {
  if (!draft.targetTicketId) return collectCard({ draftId: draft.id, items: toCardItems(items) });
  const ticket = await first<{ ticketNo: string }>(env.DB, "SELECT ticketNo FROM tickets WHERE id = ?", draft.targetTicketId);
  return addCard({ draftId: draft.id, ticketNo: ticket?.ticketNo ?? "the ticket", items: toCardItems(items) });
}

// DM the "Sign in with Feishu" link: the one way (besides an admin entering
// the mobile number) a Feishu account gets linked, always with the portal
// password on first use — never to whoever happens to be signed in.
export async function sendBindLink(env: Env, person: FeishuPerson) {
  const target = privateTarget(person);
  if (!target) return;
  await sendCard(env, target.type, target.id, bindCard(`${siteBase(env)}/api/auth/feishu/start?next=${encodeURIComponent("/")}`));
}

// A message to the bot. Only direct messages from after-sales and admins
// become material; an @ in a group gets those people a reminder in private,
// and nothing from anyone else.
export async function handleIncomingMessage(env: Env, event: any) {
  const message = event.message;
  const sender = personOf(event.sender?.sender_id);
  const target = privateTarget(sender);
  if (!target) return;
  const ownText = messageContentToText(message.message_type, message.content);
  if (message.chat_type === "p2p" && /^(绑定|bind)$/i.test(ownText.trim())) return await sendBindLink(env, sender);

  const user = await userForFeishu(env.DB, sender);
  if (message.chat_type !== "p2p") {
    if (user && canCreateTicket(user)) {
      await sendText(
        env,
        target.type,
        target.id,
        "To create a ticket, forward the customer's messages to me here in our private chat. Select them and forward them merged or one by one; pictures, voice messages and videos must be forwarded one by one."
      );
    }
    return;
  }
  if (!user) return await sendBindLink(env, sender);
  if (!canCreateTicket(user)) {
    await sendText(env, target.type, target.id, "Only after-sales and admins can create tickets here. Please pass the customer's messages to your after-sales colleague.");
    return;
  }

  let materials: Material[];
  let forwardChatId: string | null = null;
  if (message.message_type === "merge_forward") {
    const expanded = materialsFromForward(await getMessageItems(env, message.message_id), message.message_id);
    materials = expanded.materials;
    forwardChatId = expanded.chatId;
  } else {
    materials = materialsFromContent(message.message_type, message.content, message.message_id);
  }
  if (!materials.length) return;

  const now = new Date();
  const { draft, created } = await getOrOpenDraft(env, requesterKey(sender), now);
  const position = String(Number(message.create_time) || now.getTime()).padStart(15, "0");
  const added = await addMaterials(env, draft.id, materials, position, now);
  // Forwarded from a group the bot is in: offered as the group to notify.
  if (forwardChatId && !draft.suggestedChatId && forwardChatId !== (await serviceChatId(env))) {
    await suggestChat(env.DB, draft.id, forwardChatId);
  }

  if (draft.formOpenedAt) {
    // Redrawing the form would wipe what is being typed into it.
    await sendText(
      env,
      target.type,
      target.id,
      `Added to your open request: ${collectedCounts(toCardItems(added))}. Press Re-recognize on the form to include it in the AI suggestion, or Create ticket to attach it as it is.`
    );
    return;
  }
  if (created) {
    const shown = await loadItems(env.DB, draft.id);
    const cardMessageId = await sendCard(env, target.type, target.id, await collectingCard(env, draft, shown));
    await setRequestCard(env.DB, draft.id, cardMessageId);
    // Messages forwarded together may have landed while the card was sent.
    const now2 = await loadItems(env.DB, draft.id);
    if (cardMessageId && now2.length !== shown.length) await updateCard(env, cardMessageId, await collectingCard(env, draft, now2));
    return;
  }
  // Another message of the batch is still sending the card; it picks this up.
  const current = await loadDraft(env.DB, draft.id);
  if (current?.cardMessageId) await updateCard(env, current.cardMessageId, await collectingCard(env, current, await loadItems(env.DB, draft.id)));
}

// Voice messages transcribed and pictures read (Qwen), then one suggestion
// over everything. Transcripts are kept, so running it again does not redo them.
async function recognize(env: Env, draft: DraftRow, items: DraftItem[], config: AiConfig | null, types: string[], now: Date) {
  if (!config) return null;
  const voices = canTranscribe(config)
    ? items.filter((i) => i.kind === "AUDIO" && !i.text && i.r2Key && (i.size ?? 0) <= AI_MAX_VOICE_BYTES).slice(0, AI_MAX_VOICE_MESSAGES)
    : [];
  const transcripts = await Promise.all(
    voices.map(async (voice) => {
      const media = await mediaOf(env, voice, "audio/ogg");
      const text = media ? await transcribeAudio(config, media) : null;
      if (text) await saveTranscript(env.DB, voice.id, text);
      return text;
    })
  );
  if (transcripts.some(Boolean)) await refreshDraftText(env.DB, draft.id, now);
  const fresh = transcripts.some(Boolean) ? await loadItems(env.DB, draft.id) : items;
  const pictures = canReadPictures(config)
    ? fresh.filter((i) => i.kind === "IMAGE" && i.r2Key && (i.size ?? 0) <= AI_MAX_PICTURE_BYTES).slice(0, AI_MAX_PICTURES)
    : [];
  const images = (await Promise.all(pictures.map((p) => mediaOf(env, p, "image/jpeg")))).filter((m): m is AiMedia => m !== null);
  const text = compileDraftText(fresh) || draft.text;
  const triage = await triageMessages(config, { text, images }, types);
  await saveAiSuggestion(env.DB, draft.id, triage, fresh.map((i) => i.id));
  return triage;
}

async function mediaOf(env: Env, item: DraftItem, fallbackType: string): Promise<AiMedia | null> {
  const obj = item.r2Key ? await env.FILES.get(item.r2Key) : null;
  if (!obj) return null;
  const type = item.contentType && !item.contentType.startsWith("application/") ? item.contentType : fallbackType;
  return { contentType: type.split(";")[0]!.trim(), base64: toBase64(await obj.arrayBuffer()) };
}

// What the AI did not (or could not) look at, so nobody assumes it did.
function aiNotes(config: AiConfig | null, items: DraftItem[], draft: DraftRow): string[] {
  const has = (kind: DraftItem["kind"]) => items.some((i) => i.kind === kind && !i.problem);
  if (!config) return ["No AI key is set up for you, so nothing is suggested: fill in the form yourself (AI settings in the portal)."];
  const notes: string[] = [];
  if (draft.aiItemIds && !draft.aiSummary) notes.push("The AI could not make a suggestion this time. Fill in the form yourself, or press Re-recognize to try again.");
  if (has("IMAGE")) {
    if (!canReadPictures(config)) notes.push("Pictures were not read by the AI (only Qwen reads pictures). Look at them yourself.");
    else if (items.filter((i) => i.kind === "IMAGE" && i.r2Key).length > AI_MAX_PICTURES) notes.push(`The AI read the first ${AI_MAX_PICTURES} pictures only.`);
  }
  if (has("AUDIO") && !canTranscribe(config)) notes.push("Voice messages were not transcribed (only Qwen does). Listen to them yourself.");
  if (has("VIDEO")) notes.push("Videos are not read by the AI. Watch them yourself.");
  return notes;
}

export type FormRequest = {
  prefill?: DraftPrefill;
  matches?: { value: string; label: string }[] | null;
  // Run the AI (first "Prepare ticket", or "Re-recognize").
  recognize: boolean;
};

// Turns the request's card into the form (or redraws it), keeping values
// already in the form.
export async function renderDraftForm(env: Env, draftId: string, cardMessageId: string, user: AppUser, req: FormRequest) {
  const now = new Date();
  let draft = await loadDraft(env.DB, draftId);
  if (!draft) return;
  const types = await faultTypes(env.DB);
  const config = await loadUserAiConfig(env, user.id);
  let items = await loadItems(env.DB, draft.id);
  const previousAi = { summary: draft.aiSummary, details: draft.aiDigest, ticketType: draft.aiTicketType, faultType: draft.aiFaultType };
  if (req.recognize) {
    await recognize(env, draft, items, config, types, now);
    draft = (await loadDraft(env.DB, draft.id))!;
    items = await loadItems(env.DB, draft.id);
  }
  if (!draft.formOpenedAt) {
    await markFormOpened(env.DB, draft.id, now);
  }

  // A production order number or SN written in the material fills the form;
  // a known SN is kept on the request (SNs are never typed in the form).
  const refs = await findKnownReferences(env.DB, draft.text);
  if (refs.device && !draft.serialNumber) {
    await keepSerialNumber(env.DB, draft.id, refs.device.serialNumber);
  }
  const typed = { ...(req.prefill ?? {}) };
  // After a new AI run, fields still holding the previous suggestion take the
  // new one; fields someone changed by hand are kept.
  if (req.recognize) {
    if (!typed.summary || typed.summary === previousAi.summary) delete typed.summary;
    if (!typed.details || typed.details === previousAi.details) delete typed.details;
    if (!typed.ticketType || typed.ticketType === previousAi.ticketType) delete typed.ticketType;
    if (!typed.faultType || typed.faultType === previousAi.faultType) delete typed.faultType;
  }
  const serialNumber = refs.device?.serialNumber ?? draft.serialNumber ?? undefined;
  const prefill: DraftPrefill = {
    ...typed,
    serialNumber,
    orderNo: typed.orderNo || refs.device?.productionOrderNo || refs.order?.productionOrderNo || undefined,
    customerCompany: typed.customerCompany || refs.device?.customerCompany || refs.order?.customerCompany || undefined
  };

  const groupId = await serviceChatId(env);
  const chats = (await listBotChats(env).catch((error) => {
    console.error("Could not list the bot's groups", error);
    return [];
  })).filter((ch) => ch.chatId !== groupId);
  if (!prefill.notifyChat) prefill.notifyChat = draft.suggestedChatId && chats.some((ch) => ch.chatId === draft!.suggestedChatId) ? draft.suggestedChatId : "none";

  const similar = await findSimilarTickets(
    env.DB,
    {
      serialNumber,
      orderNo: prefill.orderNo,
      customerCompany: prefill.customerCompany,
      faultType: prefill.faultType ?? draft.aiFaultType
    },
    now
  );
  const seen = new Set<string>(draft.aiItemIds ? JSON.parse(draft.aiItemIds) : []);
  const changedSinceAi = draft.aiItemIds
    ? { added: items.filter((i) => !seen.has(i.id)).length, removed: [...seen].filter((idValue) => !items.some((i) => i.id === idValue)).length }
    : null;

  await updateCard(
    env,
    cardMessageId,
    draftCard({
      draftId: draft.id,
      text: draft.text,
      aiSummary: draft.aiSummary,
      aiDigest: draft.aiDigest,
      aiTicketType: draft.aiTicketType,
      aiFaultType: draft.aiFaultType,
      faultTypes: types,
      prefill,
      matches: req.matches,
      items: toCardItems(items),
      aiNotes: aiNotes(config, items, draft),
      changedSinceAi,
      similar,
      chats,
      portalUrl: env.APP_BASE_URL ?? null
    })
  );
}

// Redraws the collecting card after an item was removed.
export async function refreshCollectCard(env: Env, draftId: string, cardMessageId: string) {
  const draft = await loadDraft(env.DB, draftId);
  if (draft) await updateCard(env, cardMessageId, await collectingCard(env, draft, await loadItems(env.DB, draftId)));
}

const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/mpeg": "mp3",
  "audio/amr": "amr",
  "video/mp4": "mp4",
  "video/quicktime": "mov"
};
const KIND_NAME: Record<DraftItem["kind"], string> = { TEXT: "text", IMAGE: "picture", AUDIO: "voice", VIDEO: "video", FILE: "file" };

// Saved material as ticket attachments: files keep their names, the rest get
// one from their kind ("picture-2.jpg").
export function attachmentsFromItems(items: DraftItem[]) {
  const counters = new Map<string, number>();
  return items
    .filter((i) => i.r2Key && !i.problem)
    .map((i) => {
      const n = (counters.get(i.kind) ?? 0) + 1;
      counters.set(i.kind, n);
      const type = (i.contentType ?? "application/octet-stream").split(";")[0]!.trim();
      const ext = EXTENSION[type];
      return { fileName: i.fileName || `${KIND_NAME[i.kind]}-${n}${ext ? `.${ext}` : ""}`, contentType: type, size: i.size ?? 0, r2Key: i.r2Key! };
    });
}

