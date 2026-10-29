import type { Context } from "hono";
import { first } from "../../lib/db";
import {
  addCancelledCard,
  addCard,
  addedCard,
  alertTakenCard,
  collectCard,
  dismissedCard,
  draftCard,
  expiredDraftCard,
  addExpiredCard,
  ticketCard,
  type DraftPrefill
} from "../../lib/feishu/cards";
import { lookup, matchOptions, resolveMatch } from "../../lib/lookup";
import {
  addMaterials,
  claimAlert,
  createTicketFromRequest,
  dismissRequest,
  loadItems,
  openAddition,
  openRequestFor,
  removeItem,
  requesterKey,
  saveToTicket,
  setRequestCard,
  type DraftRow,
  type FeishuPerson,
  type RequestRefusal
} from "../../lib/feishu/ticketRequest";
import { botName, feishuEnabled, listBitableFields, listBotChats, sendCard, sendText, SERVICE_CHAT_OPTION_KEY, serviceChatId, updateCard } from "../../lib/feishu/client";
import { firstSeen, readFeishuRequest, runLater, toast } from "../../lib/feishu/inbound";
import { requestNote } from "../../lib/feishu/requestNote";
import {
  attachmentsFromItems,
  handleIncomingMessage,
  personOf,
  privateTarget,
  refreshCollectCard,
  renderDraftForm,
  sendBindLink,
  toCardItems
} from "../../lib/feishu/intake";
import { checkPoolFields, parsePoolUrl, POOL_URL_OPTION_KEY } from "../../lib/feishu/requirementPool";
import { loadTicketForCard, pushTicketChanges } from "../../lib/feishu/sync";
import { userForFeishu } from "../../lib/feishu/identity";
import { canCreateTicket } from "../../lib/ticketAccess";
import {
  addTicketNote,
  createTicket,
  takeTicket,
  updateProgress,
  TicketError
} from "../../lib/ticketWorkflow";
import type { TicketStatus } from "../../lib/ticketAccess";
import type { AppUser, Env } from "../../lib/types";
import { body, createApp } from "./_shared";

// Feishu bot endpoints (docs/adr/0002-feishu-as-after-sales-work-surface.md).
// /feishu/events and /feishu/card are called by Feishu (authenticated by its
// signature / verification token, not a portal login). Feishu accounts are
// linked through "Sign in with Feishu" (routes/feishuAuth.ts) or by an admin's
// mobile number (routes/users.ts) — see lib/feishu/identity.ts. Ticket
// requests are collected in the bot's private chat (lib/feishu/intake.ts).

export const feishuRoutes = createApp();


// Redraws a request card after the button answered. If that fails the button
// would look dead, so the person is told privately.
function redrawLater(c: Context, env: Env, operator: FeishuPerson, task: () => Promise<unknown>) {
  runLater(c, () =>
    task().catch(async (error) => {
      console.error("Could not redraw the request card", error);
      const to = privateTarget(operator);
      if (to) await sendText(env, to.type, to.id, "Sorry, I could not show the ticket form. Please press the button again; if it keeps failing, create the ticket in the portal.");
    })
  );
}

const authenticate = (c: Context) =>
  readFeishuRequest(c, { verificationToken: (c.env as Env).FEISHU_VERIFICATION_TOKEN, encryptKey: (c.env as Env).FEISHU_ENCRYPT_KEY });

// ── Events: messages to the bot (direct messages, @bot in a group) ────────

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

  runLater(c, () => handleIncomingMessage(env, event));
  return c.json({});
});

// ── Card callbacks: buttons and forms on our cards ────────────────────────

const formText = (form: Record<string, unknown>, key: string) => String(form[key] ?? "").trim();

// What has been typed into the request form, kept when it is redrawn.
const FORM_KEYS = ["customerCompany", "orderNo", "contactName", "summary", "details", "ticketType", "faultType", "lookupQuery", "notifyChat"] as const;
const typedValues = (form: Record<string, unknown>): DraftPrefill =>
  Object.fromEntries(FORM_KEYS.map((k) => [k, formText(form, k)]).filter(([, v]) => v));

// What a refused button on a request says.
const REFUSED: Record<RequestRefusal, ReturnType<typeof toast>> = {
  gone: toast("error", "This request no longer exists."),
  created: toast("info", "A ticket was already created for this."),
  discarded: toast("info", "This request was discarded."),
  unclaimed: toast("info", "Press Create ticket on the alert first."),
  notYours: toast("warning", "This request belongs to someone else."),
  inPrivate: toast("info", "This request continues in our private chat."),
  expired: toast("warning", "This request has expired (nothing added for 6 hours). Send me the messages again to start a new one."),
  additionExpired: toast("warning", "Save to ticket was not pressed within 30 minutes, so nothing was added. Press Add pictures / files on the ticket card to start again.")
};

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
  const messageId: string | null = event.context?.open_message_id ?? null;
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
        const taken = await takeTicket(env.DB, user, String(value.ticketId));
        runLater(c, () => pushTicketChanges(env, String(value.ticketId), taken.changes));
        return c.json(toast("success", "You took this ticket."));
      }
      case "update": {
        const ticketId = String(value.ticketId);
        const status = String(form.status ?? "").trim();
        const note = String(form.note ?? "").trim();
        if (!status && !note) return c.json(toast("info", "Choose a status or write a note."));
        const updated = await updateProgress(env.DB, user, ticketId, { status: (status || undefined) as TicketStatus | undefined, note });
        runLater(c, () => pushTicketChanges(env, ticketId, updated.changes));
        return c.json(toast("success", "Ticket updated."));
      }
      case "show_ticket": {
        // "Update progress" on a ticket created from a request: this card becomes the ticket card.
        const t = await loadTicketForCard(env.DB, String(value.ticketId ?? ""));
        if (!t) return c.json(toast("error", "This ticket no longer exists."));
        if (!messageId || messageId !== t.feishuCardMessageId) return c.json(toast("info", "This ticket's card is with its current after-sales owner."));
        runLater(c, () => updateCard(env, messageId, ticketCard(t, env.APP_BASE_URL ?? null)));
        return c.json(toast("info", "Opening the ticket…"));
      }
      case "add_to_ticket":
        return c.json(await startAddition(c, env, user, operator, String(value.ticketId ?? "")));
    }

    // Everything below acts on a ticket request; only after-sales and admins make tickets.
    if (!canCreateTicket(user)) return c.json(toast("warning", "Your role cannot create tickets."));
    const found = await openRequestFor(env.DB, String(value.draftId ?? ""), operator, messageId, new Date(), { allowUnclaimedAlert: value.action === "open_draft" });
    if ("refused" in found) {
      // A request left alone too long: its card is greyed out too.
      if (found.refused === "expired" && messageId) runLater(c, () => updateCard(env, messageId, expiredDraftCard()));
      if (found.refused === "additionExpired" && messageId) runLater(c, () => updateCard(env, messageId, addExpiredCard()));
      return c.json(REFUSED[found.refused]);
    }
    const draft = found.draft;
    // "Add to ticket" only saves, cancels or removes items.
    if (draft.targetTicketId && !["save_addition", "dismiss_draft", "remove_item"].includes(String(value.action))) {
      return c.json(toast("info", "This card adds to an existing ticket: press Save to ticket."));
    }

    switch (value.action) {
      case "open_draft": {
        if (draft.kind === "DEVICE_ALERT" && !draft.requestedBy) return c.json(await takeAlert(c, env, user, operator, draft, messageId));
        if (!messageId) return c.json(toast("error", "Something went wrong. Please try again."));
        // The AI runs once here; "Re-recognize" runs it again.
        redrawLater(c, env, operator, () => renderDraftForm(env, draft.id, messageId, user, { recognize: !draft.aiItemIds }));
        return c.json(toast("info", "Preparing the ticket form…"));
      }
      case "dismiss_draft": {
        await dismissRequest(env.DB, draft.id, new Date());
        if (messageId) runLater(c, () => updateCard(env, messageId, draft.targetTicketId ? addCancelledCard() : dismissedCard()));
        return c.json(toast("info", draft.targetTicketId ? "Cancelled." : "Discarded."));
      }
      case "remove_item": {
        if (!(await removeItem(env, draft.id, String(value.itemId ?? ""), new Date()))) return c.json(toast("info", "Already removed."));
        if (messageId) {
          redrawLater(c, env, operator, () =>
            draft.formOpenedAt
              ? renderDraftForm(env, draft.id, messageId, user, { prefill: typedValues(form), recognize: false })
              : refreshCollectCard(env, draft.id, messageId)
          );
        }
        return c.json(toast("info", "Removed."));
      }
      case "lookup_draft": {
        if (formText(form, "lookupQuery").length < 2) return c.json(toast("info", "Type at least 2 characters to find."));
        if (messageId) {
          redrawLater(c, env, operator, async () => {
            const matches = matchOptions(await lookup(env.DB, formText(form, "lookupQuery"), "all"));
            await renderDraftForm(env, draft.id, messageId, user, { prefill: typedValues(form), matches, recognize: false });
          });
        }
        return c.json(toast("info", "Finding matches…"));
      }
      case "rerun_draft": {
        if (messageId) redrawLater(c, env, operator, () => renderDraftForm(env, draft.id, messageId, user, { prefill: typedValues(form), recognize: true }));
        return c.json(toast("info", "Running the AI again…"));
      }
      case "confirm_draft":
        return c.json(await confirmDraft(c, env, user, draft, form, messageId));
      case "save_addition":
        if (!draft.targetTicketId) return c.json(toast("error", "Unknown action."));
        return c.json(await saveAddition(c, env, user, draft, messageId));
      default:
        return c.json(toast("error", "Unknown action."));
    }
  } catch (error) {
    if (error instanceof TicketError) return c.json(toast(error.status === 403 ? "warning" : "error", error.message));
    console.error("Feishu card action failed", error);
    return c.json(toast("error", "Something went wrong. Please try again in the portal."));
  }
});

// "Create ticket" on a device alert in the after-sales group: the alert
// becomes the presser's open request, continued in their private chat.
async function takeAlert(c: Context, env: Env, user: AppUser, operator: FeishuPerson, draft: DraftRow, groupCardId: string | null) {
  const target = privateTarget(operator);
  if (!target) return toast("warning", "Link your Feishu account first.");
  const now = new Date();
  const claim = await claimAlert(env.DB, draft.id, requesterKey(operator), now);
  if (claim === "busy") return toast("warning", "Finish or discard your open ticket request in our private chat first.");
  if (claim === "takenByOther") return toast("info", "Someone else already took this alert.");
  runLater(c, async () => {
    const position = String(now.getTime()).padStart(15, "0");
    await addMaterials(env, draft.id, [{ kind: "TEXT", text: draft.text, sourceMessageId: "", insideForward: false }], position, now);
    const cardMessageId = await sendCard(env, target.type, target.id, collectCard({ draftId: draft.id, items: toCardItems(await loadItems(env.DB, draft.id)) }));
    await setRequestCard(env.DB, draft.id, cardMessageId);
    if (groupCardId) await updateCard(env, groupCardId, alertTakenCard(draft.serialNumber ?? "", user.displayName));
  });
  return toast("success", "Continued in your private chat with me: add any material there, then press Prepare ticket.");
}

async function confirmDraft(c: Context, env: Env, user: AppUser, draft: DraftRow, form: Record<string, unknown>, cardMessageId: string | null) {
  const contactName = formText(form, "contactName");
  if (!contactName) return toast("warning", "Enter the customer contact name.");

  const summary = formText(form, "summary");
  const details = formText(form, "details");
  // A picked match fills the customer, production order and SN it stands for.
  const picked = formText(form, "match") ? await resolveMatch(env.DB, formText(form, "match")) : null;
  const notifyChat = formText(form, "notifyChat");
  const chatId = notifyChat && notifyChat !== "none" && notifyChat !== (await serviceChatId(env)) ? notifyChat : null;
  const items = await loadItems(env.DB, draft.id);
  // Two presses cannot both create a ticket.
  const created = await createTicketFromRequest(env.DB, draft.id, (claim) =>
    createTicket(
      env,
      {
        customerCompany: picked?.customerCompany ?? formText(form, "customerCompany"),
        orderNo: picked?.orderNo ?? formText(form, "orderNo"),
        serialNumber: picked?.serialNumber ?? draft.serialNumber ?? undefined,
        contactName,
        contactInfo: "Feishu",
        // The customer group hears about it only when one was chosen.
        feishuSourceChatId: chatId,
        feishuSourceMessageId: null,
        summary,
        // The details (the AI's roll-up, as checked by staff) and the customer's own
        // words go on the timeline, recorded as the confirming user.
        initialNote: {
          actorId: user.id,
          text: requestNote(details, draft.text || "(files only)")
        }
      },
      {
        requireProduct: false,
        creator: user,
        initialFiles: attachmentsFromItems(items),
        // Type and fault type are optional here, and only after-sales/admin may set them.
        ticketType: form.ticketType,
        faultType: formText(form, "faultType"),
        // When the creator owns the new ticket, this card becomes its card: no second one is sent.
        feishuCardMessageId: cardMessageId,
        // A ticket from a device alert is linked to that alert.
        alertDraftId: draft.kind === "DEVICE_ALERT" ? draft.id : null,
        // Linked to the new ticket in the same batch.
        request: claim
      }
    )
  );
  if (!created) return toast("info", "A ticket was already created for this.");

  runLater(c, async () => {
    await pushTicketChanges(env, created.id, created.changes);
    if (cardMessageId) {
      await updateCard(
        env,
        cardMessageId,
        draftCard({
          draftId: draft.id,
          text: draft.text,
          aiSummary: null,
          aiTicketType: null,
          aiFaultType: null,
          faultTypes: [],
          createdTicketNo: created.ticketNo,
          createdTicketId: created.ownCard ? created.id : null,
          items: toCardItems(items),
          portalUrl: env.APP_BASE_URL ?? null
        })
      );
    }
  });
  return toast("success", `Ticket ${created.ticketNo} created.`);
}

// "Add pictures / files" on a ticket card: what the person sends next in our
// private chat is collected for that ticket, like a request, until they save.
async function startAddition(c: Context, env: Env, user: AppUser, operator: FeishuPerson, ticketId: string) {
  if (!canCreateTicket(user)) return toast("warning", "Only after-sales and admins can add files here. Use the portal instead.");
  const ticket = await first<{ id: string; ticketNo: string; status: string }>(env.DB, "SELECT id, ticketNo, status FROM tickets WHERE id = ?", ticketId);
  if (!ticket) return toast("error", "This ticket no longer exists.");
  if (ticket.status === "CLOSED") return toast("info", "This ticket is closed.");
  const target = privateTarget(operator);
  if (!target) return toast("error", "Something went wrong. Please try again.");
  const { draft, created } = await openAddition(env, requesterKey(operator), ticket.id, new Date());
  if (!created) {
    if (draft.targetTicketId === ticket.id) return toast("info", `Already adding to ${ticket.ticketNo}: send the pictures and files in our private chat.`);
    return toast(
      "warning",
      draft.targetTicketId ? "You are adding to another ticket: save or cancel that first." : "You have an open ticket request: create the ticket or discard it first."
    );
  }
  runLater(c, async () => {
    const cardMessageId = await sendCard(env, target.type, target.id, addCard({ draftId: draft.id, ticketNo: ticket.ticketNo, items: [] }));
    await setRequestCard(env.DB, draft.id, cardMessageId);
    // Something sent while the card was on its way is shown now.
    const items = await loadItems(env.DB, draft.id);
    if (cardMessageId && items.length) await updateCard(env, cardMessageId, addCard({ draftId: draft.id, ticketNo: ticket.ticketNo, items: toCardItems(items) }));
  });
  return toast("info", `Send me the pictures and files for ${ticket.ticketNo} in our private chat.`);
}

// "Save to ticket": the texts become one progress note, the files its attachments.
async function saveAddition(c: Context, env: Env, user: AppUser, draft: DraftRow, cardMessageId: string | null) {
  const items = await loadItems(env.DB, draft.id);
  if (!items.length) return toast("info", "Send me something to add first.");
  const ticketId = draft.targetTicketId!;
  // Two presses cannot add it twice.
  const added = await saveToTicket(env.DB, draft, (claim) =>
    addTicketNote(env.DB, user, ticketId, draft.text, { withAttachments: true, files: attachmentsFromItems(items), request: claim })
  );
  if (!added) return toast("info", "Already added.");
  const ticketNo = (await first<{ ticketNo: string }>(env.DB, "SELECT ticketNo FROM tickets WHERE id = ?", ticketId))?.ticketNo ?? "the ticket";
  runLater(c, async () => {
    await pushTicketChanges(env, ticketId, added.changes);
    if (cardMessageId) await updateCard(env, cardMessageId, addedCard(ticketNo, toCardItems(items)));
  });
  return toast("success", `Added to ${ticketNo}.`);
}

// Groups the bot is in, for "Notify customer group" on the portal's New
// ticket page (not the internal after-sales group).
feishuRoutes.get("/feishu/chats", async (c) => {
  if (!canCreateTicket(c.get("user"))) return c.json({ error: "Forbidden" }, 403);
  const env = c.env as Env;
  if (!feishuEnabled(env)) return c.json([]);
  try {
    const groupId = await serviceChatId(env);
    return c.json((await listBotChats(env)).filter((ch) => ch.chatId !== groupId));
  } catch (error) {
    console.error("Could not list the bot's groups", error);
    return c.json([]);
  }
});

// The after-sales bot's name in Feishu, for the portal's instructions (any
// signed-in user: the AI settings page names it too). Null when unknown.
feishuRoutes.get("/feishu/bot", async (c) => {
  const env = c.env as Env;
  if (!feishuEnabled(env)) return c.json({ name: null });
  try {
    return c.json({ name: await botName(env) });
  } catch (error) {
    console.error("Could not read the bot's name", error);
    return c.json({ name: null });
  }
});

// ── After-sales group settings (admin) ───────────────────────────────────────
// The internal group for the weekly summary, repeat-fault and device alerts,
// picked from the groups the bot is in. Saved in appOptions; the
// FEISHU_SERVICE_CHAT_ID setting is the fallback when nothing is picked.

feishuRoutes.get("/feishu/service-chat", async (c) => {
  if (c.get("user").role !== "ADMIN") return c.json({ error: "Admin access required" }, 403);
  const env = c.env as Env;
  const saved = await first<{ value: string }>(env.DB, "SELECT value FROM appOptions WHERE optionKey = ? LIMIT 1", SERVICE_CHAT_OPTION_KEY);
  const fallback = env.FEISHU_SERVICE_CHAT_ID?.trim() || null;
  const state = { configured: feishuEnabled(env), chatId: saved?.value || fallback, source: saved?.value ? "setting" : fallback ? "env" : null };
  if (!state.configured) return c.json({ ...state, chats: [] });
  try {
    return c.json({ ...state, chats: await listBotChats(env) });
  } catch (error) {
    return c.json({ ...state, chats: [], error: `Could not list the bot's groups: ${error instanceof Error ? error.message : String(error)}` });
  }
});

feishuRoutes.put("/feishu/service-chat", async (c) => {
  if (c.get("user").role !== "ADMIN") return c.json({ error: "Admin access required" }, 403);
  const env = c.env as Env;
  const chatId = String((await body<{ chatId?: string }>(c)).chatId ?? "").trim();
  if (chatId) {
    if (!feishuEnabled(env)) return c.json({ error: "The Feishu bot is not configured on this server." }, 400);
    const chats = await listBotChats(env).catch(() => []);
    if (!chats.some((ch) => ch.chatId === chatId)) return c.json({ error: "Choose a group the bot is in." }, 400);
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM appOptions WHERE optionKey = ?").bind(SERVICE_CHAT_OPTION_KEY),
    ...(chatId
      ? [env.DB.prepare("INSERT INTO appOptions (id, optionKey, value, sortOrder) VALUES (?, ?, ?, 0)").bind(`opt_${SERVICE_CHAT_OPTION_KEY}`, SERVICE_CHAT_OPTION_KEY, chatId)]
      : [])
  ]);
  return c.json({ ok: true });
});

feishuRoutes.post("/feishu/service-chat/test", async (c) => {
  const user = c.get("user");
  if (user.role !== "ADMIN") return c.json({ error: "Admin access required" }, 403);
  const env = c.env as Env;
  const groupId = feishuEnabled(env) ? await serviceChatId(env) : null;
  if (!groupId) return c.json({ error: "No after-sales group is set." }, 400);
  try {
    await sendText(env, "chat_id", groupId, `Test from the Sales Portal (sent by ${user.displayName}): this is the after-sales group for the weekly summary and alerts.`);
    return c.json({ ok: true });
  } catch (error) {
    return c.json({ error: `Feishu refused: ${error instanceof Error ? error.message : String(error)}` }, 502);
  }
});


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
