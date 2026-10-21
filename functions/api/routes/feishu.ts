import type { Context } from "hono";
import { all, first, id } from "../../lib/db";
import { TICKET_TYPES, triageMessages } from "../../lib/aiTriage";
import { bindCard, dismissedCard, draftCard, expiredDraftCard, promptCard, type DraftPrefill } from "../../lib/feishu/cards";
import { findKnownReferences, lookup, matchOptions, resolveMatch } from "../../lib/lookup";
import { isDraftExpired } from "../../lib/feishu/drafts";
import { feishuEnabled, getMessageText, listBitableFields, messageContentToText, sendCard, updateCard } from "../../lib/feishu/client";
import { readIncoming } from "../../lib/feishu/crypto";
import { checkPoolFields, parsePoolUrl, POOL_URL_OPTION_KEY } from "../../lib/feishu/requirementPool";
import { pushTicketChange } from "../../lib/feishu/sync";
import { feishuTarget, userForFeishu } from "../../lib/feishu/identity";
import { siteBase } from "../../lib/feishu/piBot/notifyPi";
import { canCreateTicket } from "../../lib/ticketAccess";
import {
  addTicketNote,
  changeTicketStatus,
  confirmTicketFault,
  createTicket,
  FAULT_TYPE_OPTION_KEY,
  setTicketType,
  takeTicket,
  TicketError
} from "../../lib/ticketService";
import type { TicketStatus } from "../../lib/ticketAccess";
import type { AppUser, Env } from "../../lib/types";
import { loadUserAiConfig } from "../../lib/userAi";
import { body, createApp } from "./_shared";

// Feishu bot endpoints (docs/adr/0002-feishu-as-after-sales-work-surface.md).
// /feishu/events and /feishu/card are called by Feishu (authenticated by its
// signature / verification token, not a portal login). Feishu accounts are
// linked through "Sign in with Feishu" (routes/feishuAuth.ts) or by an admin's
// mobile number (routes/users.ts) — see lib/feishu/identity.ts.

export const feishuRoutes = createApp();


function runLater(c: Context, task: () => Promise<unknown>) {
  const promise = task().catch((error) => console.error("Feishu background task failed", error));
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    void promise;
  }
}

async function authenticate(c: Context) {
  const env = c.env as Env;
  const rawBody = await c.req.text();
  return readIncoming(
    rawBody,
    {
      timestamp: c.req.header("x-lark-request-timestamp") ?? null,
      nonce: c.req.header("x-lark-request-nonce") ?? null,
      signature: c.req.header("x-lark-signature") ?? null
    },
    { verificationToken: env.FEISHU_VERIFICATION_TOKEN, encryptKey: env.FEISHU_ENCRYPT_KEY }
  );
}

// Returns true the first time a key is seen; Feishu may push an event twice.
async function firstSeen(db: D1Database, key: string): Promise<boolean> {
  const res = await db.prepare("INSERT OR IGNORE INTO feishuSeenEvents (eventKey) VALUES (?)").bind(key).run();
  return (res.meta?.changes ?? 0) > 0;
}

// Feishu ids of an event's sender or card operator.
type FeishuPerson = { unionId: string; openId: string };
const personOf = (ids: any): FeishuPerson => ({ unionId: String(ids?.union_id ?? ""), openId: String(ids?.open_id ?? "") });
const privateTarget = (p: FeishuPerson) => feishuTarget({ feishuUnionId: p.unionId || null, feishuOpenId: p.openId || null });

async function faultTypes(db: D1Database) {
  return (await all<{ value: string }>(db, "SELECT value FROM appOptions WHERE optionKey = ? ORDER BY sortOrder, value", FAULT_TYPE_OPTION_KEY)).map((r) => r.value);
}

// DM the "Sign in with Feishu" link: the one way (besides an admin entering
// the mobile number) a Feishu account gets linked, always with the portal
// password on first use — never to whoever happens to be signed in.
async function sendBindLink(env: Env, person: FeishuPerson) {
  const target = privateTarget(person);
  if (!target) return;
  await sendCard(env, target.type, target.id, bindCard(`${siteBase(env)}/api/auth/feishu/start?next=${encodeURIComponent("/")}`));
}

// ── Events: @bot in a group (or a DM to the bot) ──────────────────────────

feishuRoutes.post("/feishu/events", async (c) => {
  const incoming = await authenticate(c);
  if (!incoming.ok) return c.json({ error: incoming.reason }, 401);
  const payload = incoming.payload;
  if (payload.type === "url_verification") return c.json({ challenge: payload.challenge });

  const env = c.env as Env;
  if (!feishuEnabled(env) || payload.header?.event_type !== "im.message.receive_v1") return c.json({});
  const event = payload.event ?? {};
  const message = event.message ?? {};
  if (event.sender?.sender_type !== "user" || !message.message_id) return c.json({});
  // Feishu advises de-duplicating message events by message_id.
  if (!(await firstSeen(env.DB, `msg:${message.message_id}`))) return c.json({});

  runLater(c, () => handleTicketRequest(env, event));
  return c.json({});
});

// An @-mention in a group (Feishu only delivers those) or any direct message.
// Nothing is created and no AI runs yet: the bot first asks "turn this into a
// ticket?" with a small card, so casual messages cost nothing and can be
// ignored. The quoted message, when staff reply to a customer's message and @
// the bot, is the request.
async function handleTicketRequest(env: Env, event: any) {
  const message = event.message;
  const sender = personOf(event.sender?.sender_id);
  const ownText = messageContentToText(message.message_type, message.content);
  // "绑定" / "bind" in a direct message: just send the link-your-account card.
  if (message.chat_type === "p2p" && privateTarget(sender) && /^(绑定|bind)$/i.test(ownText.trim())) {
    await sendBindLink(env, sender);
    return;
  }
  const quoted = message.parent_id ? await getMessageText(env, message.parent_id).catch(() => "") : "";
  const text = [quoted, ownText].filter(Boolean).join("\n— ").slice(0, 4000) || "(no text)";

  const draftId = id("fdr");
  await env.DB.prepare(
    "INSERT INTO feishuDrafts (id, requestedBy, sourceChatId, sourceMessageId, text) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(draftId, sender.unionId || sender.openId, message.chat_id, message.parent_id || message.message_id, text)
    .run();

  const card = promptCard({ draftId, text });
  // Staff who asked get the question privately; anyone else's request (e.g. a
  // customer's own @bot) goes to the internal after-sales group to pick up.
  const requester = await userForFeishu(env.DB, sender);
  const requesterTarget = privateTarget(sender);
  const cardMessageId =
    requester && requesterTarget && canCreateTicket(requester)
      ? await sendCard(env, requesterTarget.type, requesterTarget.id, card)
      : await sendCard(env, "chat_id", env.FEISHU_SERVICE_CHAT_ID!, card);
  await env.DB.prepare("UPDATE feishuDrafts SET cardMessageId = ? WHERE id = ?").bind(cardMessageId || null, draftId).run();
}

// A request left unanswered too long: say so, and grey out its card.
async function refuseExpired(c: Context, env: Env, draftId: string, cardMessageId: string | null) {
  await env.DB.prepare("UPDATE feishuDrafts SET expiredAt = COALESCE(expiredAt, CURRENT_TIMESTAMP) WHERE id = ?").bind(draftId).run();
  if (cardMessageId) runLater(c, () => updateCard(env, cardMessageId, expiredDraftCard()));
  return toast("warning", "This request has expired (6 hours). @ the bot again to start a new one.");
}

// "Create ticket" on the prompt: turn that card into the form, with AI
// suggestions when the person who pressed it has their own AI key set up.
async function openDraftForm(env: Env, draftId: string, cardMessageId: string | null, user: AppUser) {
  const draft = await first<any>(env.DB, "SELECT * FROM feishuDrafts WHERE id = ?", draftId);
  if (!draft || !cardMessageId) return;
  const types = await faultTypes(env.DB);
  const triage = draft.aiSummary
    ? { summary: draft.aiSummary, ticketType: draft.aiTicketType, faultType: draft.aiFaultType }
    : await triageMessages(await loadUserAiConfig(env, user.id), draft.text, types);
  if (triage && !draft.aiSummary) {
    await env.DB.prepare("UPDATE feishuDrafts SET aiSummary = ?, aiTicketType = ?, aiFaultType = ? WHERE id = ?")
      .bind(triage.summary, triage.ticketType, triage.faultType, draftId)
      .run();
  }
  // A production order number or SN written in the message fills the form;
  // a known SN is kept on the request (SNs are never typed in the form).
  const refs = await findKnownReferences(env.DB, draft.text);
  if (refs.device && !draft.serialNumber) {
    await env.DB.prepare("UPDATE feishuDrafts SET serialNumber = ? WHERE id = ?").bind(refs.device.serialNumber, draftId).run();
  }
  const prefill: DraftPrefill = {
    // A device alert starts with its SN even when it is not registered on a PI.
    serialNumber: refs.device?.serialNumber ?? draft.serialNumber ?? undefined,
    orderNo: refs.device?.productionOrderNo || refs.order?.productionOrderNo,
    customerCompany: refs.device?.customerCompany || refs.order?.customerCompany
  };
  await updateCard(
    env,
    cardMessageId,
    draftCard({
      draftId,
      text: draft.text,
      aiSummary: triage?.summary ?? null,
      aiTicketType: triage?.ticketType ?? null,
      aiFaultType: triage?.faultType ?? null,
      faultTypes: types,
      prefill
    })
  );
}

const formText = (form: Record<string, unknown>, key: string) => String(form[key] ?? "").trim();

// "Find" on the form: look the typed text up and redraw the card with the
// matches to pick from, keeping everything already filled in.
async function lookupForDraft(env: Env, draftId: string, form: Record<string, unknown>, cardMessageId: string | null) {
  const draft = await first<any>(env.DB, "SELECT * FROM feishuDrafts WHERE id = ?", draftId);
  if (!draft || !cardMessageId) return;
  const query = formText(form, "lookupQuery");
  const matches = matchOptions(await lookup(env.DB, query, "all"));
  const prefill: DraftPrefill = {
    ...Object.fromEntries(
      ["customerCompany", "orderNo", "contactName", "summary", "ticketType", "faultType", "lookupQuery"].map((k) => [k, formText(form, k) || undefined])
    ),
    serialNumber: draft.serialNumber ?? undefined
  };
  await updateCard(
    env,
    cardMessageId,
    draftCard({
      draftId,
      text: draft.text,
      aiSummary: draft.aiSummary,
      aiTicketType: draft.aiTicketType,
      aiFaultType: draft.aiFaultType,
      faultTypes: await faultTypes(env.DB),
      prefill,
      matches
    })
  );
}

// ── Card callbacks: buttons and forms on our cards ────────────────────────

const toast = (type: "success" | "info" | "warning" | "error", content: string) => ({ toast: { type, content } });

feishuRoutes.post("/feishu/card", async (c) => {
  const incoming = await authenticate(c);
  if (!incoming.ok) return c.json({ error: incoming.reason }, 401);
  const payload = incoming.payload;
  if (payload.type === "url_verification") return c.json({ challenge: payload.challenge });

  const env = c.env as Env;
  const event = payload.event ?? {};
  const operator = personOf(event.operator);
  const value = (typeof event.action?.value === "object" && event.action?.value) || {};
  const form = event.action?.form_value ?? {};
  if (payload.header?.event_id && !(await firstSeen(env.DB, `card:${payload.header.event_id}`))) {
    return c.json(toast("info", "Already handled."));
  }

  const user = await userForFeishu(env.DB, operator);
  if (!user) {
    if (privateTarget(operator)) runLater(c, () => sendBindLink(env, operator));
    return c.json(toast("warning", "Link your Feishu account first — we sent you a link in a private message."));
  }

  try {
    switch (value.action) {
      case "take": {
        await takeTicket(env.DB, user, String(value.ticketId));
        runLater(c, () => pushTicketChange(env, String(value.ticketId), { kind: "taken" }));
        return c.json(toast("success", "You took this ticket."));
      }
      case "update": {
        const ticketId = String(value.ticketId);
        const status = String(form.status ?? "").trim();
        const note = String(form.note ?? "").trim();
        if (!status && !note) return c.json(toast("info", "Choose a status or write a note."));
        if (status) await changeTicketStatus(env.DB, user, ticketId, status as TicketStatus);
        if (note) await addTicketNote(env.DB, user, ticketId, note);
        runLater(c, async () => {
          if (status) await pushTicketChange(env, ticketId, { kind: "status", to: status });
          if (note) await pushTicketChange(env, ticketId, { kind: "note" });
        });
        return c.json(toast("success", "Ticket updated."));
      }
      case "open_draft": {
        if (!canCreateTicket(user)) return c.json(toast("warning", "Your role cannot create tickets."));
        const messageId = event.context?.open_message_id ?? null;
        const draft = await first<{ createdAt: string; expiredAt: string | null; ticketId: string | null; kind: string }>(
          env.DB,
          "SELECT createdAt, expiredAt, ticketId, kind FROM feishuDrafts WHERE id = ?",
          String(value.draftId)
        );
        if (draft?.ticketId) return c.json(toast("info", "A ticket was already created for this."));
        if (draft && isDraftExpired(draft, new Date())) return c.json(await refuseExpired(c, env, String(value.draftId), messageId));
        runLater(c, () => openDraftForm(env, String(value.draftId), messageId, user));
        return c.json(toast("info", "Opening the ticket form…"));
      }
      case "dismiss_draft": {
        const messageId = event.context?.open_message_id ?? null;
        if (messageId) runLater(c, () => updateCard(env, messageId, dismissedCard()));
        return c.json(toast("info", "Ignored."));
      }
      case "lookup_draft": {
        const messageId = event.context?.open_message_id ?? null;
        const draft = await first<{ createdAt: string; expiredAt: string | null; ticketId: string | null; kind: string }>(
          env.DB,
          "SELECT createdAt, expiredAt, ticketId, kind FROM feishuDrafts WHERE id = ?",
          String(value.draftId)
        );
        if (draft?.ticketId) return c.json(toast("info", "A ticket was already created for this message."));
        if (draft && isDraftExpired(draft, new Date())) return c.json(await refuseExpired(c, env, String(value.draftId), messageId));
        if (formText(form, "lookupQuery").length < 2) return c.json(toast("info", "Type at least 2 characters to find."));
        runLater(c, () => lookupForDraft(env, String(value.draftId), form, messageId));
        return c.json(toast("info", "Finding matches…"));
      }
      case "confirm_draft":
        return c.json(await confirmDraft(c, env, user, String(value.draftId), form, event.context?.open_message_id ?? null));
      default:
        return c.json(toast("error", "Unknown action."));
    }
  } catch (error) {
    if (error instanceof TicketError) return c.json(toast(error.status === 403 ? "warning" : "error", error.message));
    console.error("Feishu card action failed", error);
    return c.json(toast("error", "Something went wrong. Please try again in the portal."));
  }
});

async function confirmDraft(
  c: Context,
  env: Env,
  user: AppUser,
  draftId: string,
  form: Record<string, unknown>,
  cardMessageId: string | null
) {
  if (!canCreateTicket(user)) return toast("warning", "Your role cannot create tickets.");
  const draft = await first<any>(env.DB, "SELECT * FROM feishuDrafts WHERE id = ?", draftId);
  if (!draft) return toast("error", "This request no longer exists.");
  if (draft.ticketId) return toast("info", "A ticket was already created for this message.");
  if (isDraftExpired(draft, new Date())) return await refuseExpired(c, env, draftId, cardMessageId);
  const contactName = String(form.contactName ?? "").trim();
  if (!contactName) return toast("warning", "Enter the customer contact name.");

  const summary = String(form.summary ?? "").trim();
  // A picked match fills the customer, production order and SN it stands for.
  const picked = formText(form, "match") ? await resolveMatch(env.DB, formText(form, "match")) : null;
  const created = await createTicket(
    env,
    {
      customerCompany: picked?.customerCompany ?? String(form.customerCompany ?? ""),
      orderNo: picked?.orderNo ?? String(form.orderNo ?? ""),
      serialNumber: picked?.serialNumber ?? draft.serialNumber ?? undefined,
      contactName,
      contactInfo: "Feishu group",
      feishuSourceChatId: draft.sourceChatId,
      feishuSourceMessageId: draft.sourceMessageId,
      summary,
      // The customer's own words go on the timeline, recorded as the confirming user.
      initialNote: { actorId: user.id, text: `From Feishu: ${draft.text}` }
    },
    { requireProduct: false, validateQuestionnaire: false, creator: user }
  );
  await env.DB.prepare("UPDATE feishuDrafts SET ticketId = ? WHERE id = ?").bind(created.id, draftId).run();
  // A ticket from a device alert is linked to that alert.
  if (draft.kind === "DEVICE_ALERT") await env.DB.prepare("UPDATE deviceStatus SET alertTicketId = ? WHERE alertDraftId = ?").bind(created.id, draftId).run();
  // Type and fault type are optional here, and only after-sales/admin may set them.
  const ticketType = TICKET_TYPES.find((t) => t === form.ticketType);
  const fault = String(form.faultType ?? "").trim();
  let toPool = false;
  if (ticketType && ticketType !== "FAULT") {
    toPool = await setTicketType(env.DB, user, created.id, { ticketType }).then((r) => r.becameProductRequest).catch(() => false);
  } else if (fault) {
    await confirmTicketFault(env.DB, user, created.id, fault).catch(() => undefined);
  } else if (ticketType === "FAULT") {
    await setTicketType(env.DB, user, created.id, { ticketType }).catch(() => undefined);
  }

  runLater(c, async () => {
    await pushTicketChange(env, created.id, { kind: "created" });
    if (toPool) await pushTicketChange(env, created.id, { kind: "type", ticketType: "PRODUCT_REQUEST", toPool: true });
    if (cardMessageId) {
      await updateCard(env, cardMessageId, draftCard({ draftId, text: draft.text, aiSummary: null, aiTicketType: null, aiFaultType: null, faultTypes: [], createdTicketNo: created.ticketNo }));
    }
  });
  return toast("success", `Ticket ${created.ticketNo} created.`);
}


// ── Requirement pool settings (admin): check the Bitable is reachable ──────

feishuRoutes.get("/feishu/requirement-pool/check", async (c) => {
  if (c.get("user").role !== "ADMIN") return c.json({ error: "Admin access required" }, 403);
  const env = c.env as Env;
  const row = await first<{ value: string }>(env.DB, "SELECT value FROM appOptions WHERE optionKey = ? LIMIT 1", POOL_URL_OPTION_KEY);
  if (!row) return c.json({ ok: false, error: "No requirement pool link saved yet." });
  const target = parsePoolUrl(row.value);
  if (!target) return c.json({ ok: false, error: "This is not a Bitable table link (…/base/<id>?table=tbl…). Open the table in Feishu and copy the link from the address bar." });
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) return c.json({ ok: false, error: "The Feishu bot is not configured on this server." });
  try {
    const check = checkPoolFields(await listBitableFields(env, target.appToken, target.tableId));
    return c.json({ ok: check.missing.length === 0 && check.notText.length === 0, ...check });
  } catch (error) {
    return c.json({
      ok: false,
      error: `Feishu refused: ${error instanceof Error ? error.message : String(error)}. Add the bot as an editor of the base and make sure the app has the bitable:app permission.`
    });
  }
});
