import type { Context } from "hono";
import { all, first, id } from "../../lib/db";
import { triageMessages } from "../../lib/aiTriage";
import { bindCard, draftCard } from "../../lib/feishu/cards";
import { feishuEnabled, getMessageText, messageContentToText, sendCard, updateCard } from "../../lib/feishu/client";
import { readIncoming } from "../../lib/feishu/crypto";
import { pushTicketChange } from "../../lib/feishu/sync";
import { canUseTickets } from "../../lib/ticketAccess";
import {
  addTicketNote,
  changeTicketStatus,
  confirmTicketFault,
  createTicket,
  FAULT_TYPE_OPTION_KEY,
  takeTicket,
  TicketError
} from "../../lib/ticketService";
import type { TicketStatus } from "../../lib/ticketAccess";
import type { AppUser, Env } from "../../lib/types";
import { body, createApp } from "./_shared";

// Feishu bot endpoints (docs/adr/0002-feishu-as-after-sales-work-surface.md).
// /feishu/events and /feishu/card are called by Feishu (authenticated by its
// signature / verification token, not a portal login); /feishu/bind is called
// by a signed-in portal user to link their Feishu account.

export const feishuRoutes = createApp();

const BIND_TOKEN_TTL_MS = 30 * 60 * 1000;

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

async function userForOpenId(db: D1Database, openId: string): Promise<AppUser | null> {
  return await first<AppUser>(db, "SELECT id, username, displayName, role FROM users WHERE feishuOpenId = ?", openId);
}

async function faultTypes(db: D1Database) {
  return (await all<{ value: string }>(db, "SELECT value FROM appOptions WHERE optionKey = ? ORDER BY sortOrder, value", FAULT_TYPE_OPTION_KEY)).map((r) => r.value);
}

// DM a one-time link that ties this Feishu account to a portal account.
async function sendBindLink(env: Env, openId: string) {
  const token = id("fbt");
  const expiresAt = new Date(Date.now() + BIND_TOKEN_TTL_MS).toISOString();
  await env.DB.prepare("INSERT INTO feishuBindTokens (token, openId, expiresAt) VALUES (?, ?, ?)").bind(token, openId, expiresAt).run();
  const base = env.APP_BASE_URL ?? "";
  await sendCard(env, "open_id", openId, bindCard(`${base}/feishu/bind?token=${encodeURIComponent(token)}`));
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

// A staff member replies to a customer's message with @bot (the quoted message
// is the request), or a customer @-mentions the bot directly. Either way a
// private confirmation card is sent; nothing is created yet.
async function handleTicketRequest(env: Env, event: any) {
  const message = event.message;
  const requesterOpenId = String(event.sender?.sender_id?.open_id ?? "");
  const ownText = messageContentToText(message.message_type, message.content);
  const quoted = message.parent_id ? await getMessageText(env, message.parent_id).catch(() => "") : "";
  const text = [quoted, ownText].filter(Boolean).join("\n— ").slice(0, 4000) || "(no text)";

  const types = await faultTypes(env.DB);
  const triage = await triageMessages(env, text, types);
  const draftId = id("fdr");
  await env.DB.prepare(
    "INSERT INTO feishuDrafts (id, requestedByOpenId, sourceChatId, sourceMessageId, text, aiSummary, aiFaultType) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(draftId, requesterOpenId, message.chat_id, message.parent_id || message.message_id, text, triage?.summary ?? null, triage?.faultType ?? null)
    .run();

  const card = draftCard({ draftId, text, aiSummary: triage?.summary ?? null, aiFaultType: triage?.faultType ?? null, faultTypes: types });
  // Staff who asked get the card privately; a customer's own @bot request goes
  // to the internal after-sales group for anyone to pick up.
  const requester = requesterOpenId ? await userForOpenId(env.DB, requesterOpenId) : null;
  if (requester && canUseTickets(requester)) await sendCard(env, "open_id", requesterOpenId, card);
  else await sendCard(env, "chat_id", env.FEISHU_SERVICE_CHAT_ID!, card);
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
  const openId = String(event.operator?.open_id ?? "");
  const value = (typeof event.action?.value === "object" && event.action?.value) || {};
  const form = event.action?.form_value ?? {};
  if (payload.header?.event_id && !(await firstSeen(env.DB, `card:${payload.header.event_id}`))) {
    return c.json(toast("info", "Already handled."));
  }

  const user = openId ? await userForOpenId(env.DB, openId) : null;
  if (!user) {
    if (openId) runLater(c, () => sendBindLink(env, openId));
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
  if (!canUseTickets(user)) return toast("warning", "Your role cannot create tickets.");
  const draft = await first<any>(env.DB, "SELECT * FROM feishuDrafts WHERE id = ?", draftId);
  if (!draft) return toast("error", "This request no longer exists.");
  if (draft.ticketId) return toast("info", "A ticket was already created for this message.");
  const contactName = String(form.contactName ?? "").trim();
  if (!contactName) return toast("warning", "Enter the customer contact name.");

  const created = await createTicket(
    env,
    {
      customerCompany: String(form.customerCompany ?? ""),
      orderNo: String(form.orderNo ?? ""),
      contactName,
      contactInfo: "Feishu group",
      feishuSourceChatId: draft.sourceChatId,
      feishuSourceMessageId: draft.sourceMessageId,
      // The customer's own words go on the timeline, recorded as the confirming user.
      initialNote: { actorId: user.id, text: `From Feishu: ${draft.text}` }
    },
    { requireProduct: false, validateQuestionnaire: false }
  );
  await env.DB.prepare("UPDATE feishuDrafts SET ticketId = ? WHERE id = ?").bind(created.id, draftId).run();
  // Fault type is optional here, and only after-sales/admin may confirm it.
  const fault = String(form.faultType ?? "").trim();
  if (fault) await confirmTicketFault(env.DB, user, created.id, fault).catch(() => undefined);

  runLater(c, async () => {
    await pushTicketChange(env, created.id, { kind: "created" });
    if (cardMessageId) {
      await updateCard(env, cardMessageId, draftCard({ draftId, text: draft.text, aiSummary: null, aiFaultType: null, faultTypes: [], createdTicketNo: created.ticketNo }));
    }
  });
  return toast("success", `Ticket ${created.ticketNo} created.`);
}

// ── Binding a Feishu account to the signed-in portal user ─────────────────

feishuRoutes.post("/feishu/bind", async (c) => {
  const user = c.get("user");
  const d = await body<{ token?: string }>(c).catch(() => ({} as { token?: string }));
  const token = String(d.token ?? "");
  const row = await first<{ openId: string; expiresAt: string; usedAt: string | null }>(
    c.env.DB,
    "SELECT openId, expiresAt, usedAt FROM feishuBindTokens WHERE token = ?",
    token
  );
  if (!row || row.usedAt || row.expiresAt < new Date().toISOString()) {
    return c.json({ error: "This link has expired or was already used. Click a button on a bot card in Feishu to get a new one." }, 400);
  }
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET feishuOpenId = NULL WHERE feishuOpenId = ?").bind(row.openId),
    c.env.DB.prepare("UPDATE users SET feishuOpenId = ? WHERE id = ?").bind(row.openId, user.id),
    c.env.DB.prepare("UPDATE feishuBindTokens SET usedAt = CURRENT_TIMESTAMP WHERE token = ?").bind(token)
  ]);
  return c.json({ ok: true });
});
