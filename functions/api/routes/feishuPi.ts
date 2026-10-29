import type { Context } from "hono";
import { first } from "../../lib/db";
import { userForFeishu } from "../../lib/feishu/identity";
import { firstSeen, readFeishuRequest, runLater, toast } from "../../lib/feishu/inbound";
import { sendText } from "../../lib/feishu/piBot/client";
import { piBotApp, type PiBotApp } from "../../lib/feishu/piBot/config";
import { loadCardPi, notifyPiTransition, outcomeText, piCardUrl, siteBase, type PiTransition } from "../../lib/feishu/piBot/notifyPi";
import { buildPiCard, stepOf } from "../../lib/feishu/piBot/piCard";
import { canApprovePi, canCommerceDecide, canRejectPi, type PiRow, type Verdict } from "../../lib/piAccess";
import {
  planApprove,
  planCommerceApprove,
  planCommerceReject,
  planReject,
  runTransition,
  WorkflowConflictError,
  type TransitionPlan
} from "../../lib/piWorkflow";
import type { Env } from "../../lib/types";
import { createApp } from "./_shared";

// PI Assistant bot endpoint: Feishu events and card callbacks for the ZH PI
// approval cards (functions/lib/feishu/piBot). Called by Feishu — or by the
// local long-connection bridge (scripts/feishu-dev-bridge.mjs) — and
// authenticated by the app's encrypt key / verification token, not a portal
// login (whitelisted in [[path]].ts). Feishu wants an answer within 3s.

export const feishuPiRoutes = createApp();

type PiRowFull = PiRow & Record<string, any>;

const later = (c: Context, task: () => Promise<unknown>) => runLater(c, task, "PI Assistant background task failed");

feishuPiRoutes.post("/feishu/pi/events", async (c) => {
  const env = c.env as Env;
  const app = piBotApp(env);
  if (!app) return c.json({ error: "PI Assistant is not configured" }, 503);

  const incoming = await readFeishuRequest(c, { verificationToken: app.verificationToken, encryptKey: app.encryptKey });
  if (!incoming.ok) return c.json({ error: incoming.reason }, 401);
  const body = incoming.payload;

  if (body.type === "url_verification") return c.json({ challenge: body.challenge });

  // Feishu may push the same event twice.
  const eventId = body.header?.event_id;
  if (eventId && !(await firstSeen(env.DB, `pi:${eventId}`))) return c.json({});

  const type = body.header?.event_type;
  const event = body.event ?? {};
  if (type === "card.action.trigger") return c.json(await cardAction(c, event));
  if (type === "im.message.receive_v1") later(c, () => onMessage(c, app, event));
  return c.json({});
});

// Union ids only: an open_id belongs to one app, and this bot's never match the
// after-sales bot's stored in users.feishuOpenId.
const userByUnionId = (db: D1Database, unionId: string | undefined) => userForFeishu(db, { unionId });

async function onMessage(c: Context, app: PiBotApp, event: any) {
  const unionId = event.sender?.sender_id?.union_id;
  if (!unionId || event.message?.chat_type !== "p2p") return;
  const user = await userByUnionId(c.env.DB, unionId);
  const base = siteBase(c.env, c.req.url);
  const text = user
    ? `Hi ${user.displayName}! I send you Chinese PI approvals here; approve or reject right in the card.`
    : `Hi! Link your Feishu account to the Business Portal first (one-time): ${base}/api/auth/feishu/start?next=${encodeURIComponent("/")}`;
  await sendText(app, unionId, text);
}

// Approve / Reject pressed on an approval card.
async function cardAction(c: Context, event: any) {
  const value = event.action?.value ?? {};
  if (value.action !== "pi_approve" && value.action !== "pi_reject") return toast("info", "This button is not supported.");
  const user = await userByUnionId(c.env.DB, event.operator?.union_id);
  if (!user) return toast("error", "Link your Feishu account first: tap \"Edit on website\" and sign in once.");

  const piId = String(value.piId ?? "");
  const row = await first<PiRowFull>(c.env.DB, "SELECT * FROM pi WHERE id = ?", piId);
  if (!row) return toast("error", "This PI no longer exists.");
  const base = siteBase(c.env, c.req.url);
  const step = stepOf(row.status);

  // The card was for a step the PI has already left.
  if (!step || row.status !== value.status) {
    return { ...toast("info", "This PI was already handled."), card: await closedCard(c.env.DB, piId, base, "Already handled") };
  }

  const reject = value.action === "pi_reject";
  const note = String(event.action?.form_value?.reason ?? "").trim();
  if (reject && !note) return toast("error", "Add a reason so the submitter knows what to fix.");

  let verdict: Verdict;
  let plan: TransitionPlan;
  if (step === "PRESALES") {
    verdict = reject ? canRejectPi(user, row) : canApprovePi(user, row);
    plan = reject ? planReject(row, { note }) : planApprove(row, {});
  } else {
    verdict = canCommerceDecide(user, row);
    plan = reject ? planCommerceReject(row, { note }) : planCommerceApprove(row, new Date());
  }
  if (!verdict.allowed) return toast("error", verdict.reason);

  try {
    await runTransition(c.env.DB, row.id, plan, user.id);
  } catch (error) {
    if (error instanceof WorkflowConflictError) {
      return { ...toast("info", "This PI was already handled."), card: await closedCard(c.env.DB, piId, base, "Already handled") };
    }
    throw error;
  }

  const transition: PiTransition = reject ? "REJECTED" : "APPROVED";
  later(c, () => notifyPiTransition(c.env, { piId, transition, actor: user, step, base }));
  const message = reject
    ? "Rejected — sent back to the submitter."
    : step === "PRESALES" ? "Approved — sent to Commerce." : "Approved.";
  return { ...toast("success", message), card: await closedCard(c.env.DB, piId, base, outcomeText(transition, user.displayName, step, reject ? note : null)) };
}

async function closedCard(db: D1Database, piId: string, base: string, outcome: string) {
  const loaded = await loadCardPi(db, piId);
  if (!loaded) return undefined;
  return { type: "raw", data: buildPiCard(loaded.pi, loaded.items, { kind: "closed", outcome }, piCardUrl(base, piId, loaded.pi.status)) };
}
