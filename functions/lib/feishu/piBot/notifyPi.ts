import { all, first, id } from "../../db";
import type { AppUser, Env } from "../../types";
import { patchCard, sendCard } from "./client";
import { piBotApp, type PiBotApp } from "./config";
import { buildPiCard, STEP_LABEL, stepOf, type ApprovalStep, type CardItem, type CardPi } from "./piCard";

// PI Assistant notifications for the ZH PI approval chain, sent AFTER a
// workflow transition has committed. Failures are logged and never surface to
// the caller: the approval itself already succeeded.
//
//   → PENDING_REVIEW    action card to the picked presales approver
//   → PENDING_COMMERCE  action card to the picked commerce approver
//                       (no pick: every commerce user)
//   → APPROVED/REJECTED notice to the submitter
// Each time, earlier action cards for the PI are patched to a closed state so
// nobody acts on a stale card.

export type PiTransition = "SUBMITTED" | "APPROVED" | "REJECTED";

type PiRow = CardPi & { createdById: string; assignedToId?: string | null; commerceId?: string | null };

export function siteBase(env: Env, requestUrl?: string): string {
  const configured = String(env.APP_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  return requestUrl ? new URL(requestUrl).origin : "";
}

// Links from cards go through "Sign in with Feishu" so the site opens signed
// in. Presales edits in the ZH editor (review mode); everyone else gets the
// read-only PI page.
export function piCardUrl(base: string, piId: string, status: string): string {
  const next = status === "PENDING_REVIEW" ? `/pi/zh?piId=${encodeURIComponent(piId)}` : `/pi/view/${encodeURIComponent(piId)}`;
  return `${base}/api/auth/feishu/start?next=${encodeURIComponent(next)}`;
}

export async function loadCardPi(db: D1Database, piId: string): Promise<{ pi: PiRow; items: CardItem[] } | null> {
  const pi = await first<PiRow>(
    db,
    `SELECT pi.*, creator.displayName AS createdByName,
            presales.displayName AS presalesName, commerce.displayName AS commerceName
     FROM pi
     LEFT JOIN users creator ON creator.id = pi.createdById
     LEFT JOIN users presales ON presales.id = pi.assignedToId
     LEFT JOIN users commerce ON commerce.id = pi.commerceId
     WHERE pi.id = ?`,
    piId
  );
  if (!pi) return null;
  const rows = await all<any>(
    db,
    `SELECT piItems.*, products.nameEn, products.nameZh, products.code
     FROM piItems LEFT JOIN products ON products.id = piItems.productId
     WHERE piId = ? ORDER BY sortOrder`,
    piId
  );
  const items: CardItem[] = rows.map((r) => ({
    productName: r.nameEn || r.nameZh || r.code || "Product",
    quantity: Number(r.quantity),
    unitPrice: Number(r.unitPrice),
    discountPct: Number(r.discountPct),
    fieldValues: parseFieldValues(r.fieldValues)
  }));
  return { pi, items };
}

function parseFieldValues(raw: unknown): Array<{ label: string; value: string }> {
  try {
    const parsed = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(parsed) ? parsed.map((f) => ({ label: String(f.label ?? ""), value: String(f.value ?? "") })) : [];
  } catch {
    return [];
  }
}

// Outcome line for earlier action cards, e.g. "Approved by Pat (Presales)".
export function outcomeText(transition: PiTransition, actorName: string, step: ApprovalStep | null, note?: string | null): string {
  const at = step ? ` (${STEP_LABEL[step]})` : "";
  if (transition === "APPROVED") return `Approved by ${actorName}${at}`;
  if (transition === "REJECTED") return `Rejected by ${actorName}${at}${note ? `: ${note}` : ""}`;
  return "Superseded by a new submission";
}

// Union ids of whoever must act on the PI's current step.
async function approverUnionIds(db: D1Database, pi: PiRow): Promise<string[]> {
  if (pi.status === "PENDING_REVIEW") {
    if (!pi.assignedToId) return [];
    const row = await first<{ feishuUnionId: string | null }>(db, "SELECT feishuUnionId FROM users WHERE id = ?", pi.assignedToId);
    return row?.feishuUnionId ? [row.feishuUnionId] : [];
  }
  if (pi.status === "PENDING_COMMERCE") {
    const rows = pi.commerceId
      ? await all<{ feishuUnionId: string }>(db, "SELECT feishuUnionId FROM users WHERE id = ? AND feishuUnionId IS NOT NULL", pi.commerceId)
      : await all<{ feishuUnionId: string }>(db, "SELECT feishuUnionId FROM users WHERE role = 'COMMERCE' AND feishuUnionId IS NOT NULL");
    return rows.map((r) => r.feishuUnionId);
  }
  return [];
}

export async function notifyPiTransition(
  env: Env,
  args: { piId: string; transition: PiTransition; actor: AppUser; step: ApprovalStep | null; base: string }
): Promise<void> {
  const app = piBotApp(env);
  if (!app) return;
  try {
    const loaded = await loadCardPi(env.DB, args.piId);
    if (!loaded) return;
    const { pi, items } = loaded;
    const url = piCardUrl(args.base, pi.id, pi.status);
    const outcome = outcomeText(args.transition, args.actor.displayName, args.step, pi.rejectionNote);

    await closeEarlierCards(env.DB, app, pi, items, outcome, url);

    if (stepOf(pi.status)) {
      const submissions = await first<{ n: number }>(
        env.DB,
        "SELECT COUNT(*) AS n FROM piReviewEvents WHERE piId = ? AND action = 'SUBMITTED'",
        pi.id
      );
      const card = buildPiCard(pi, items, { kind: "action", resubmission: (submissions?.n ?? 0) > 1 }, url);
      for (const unionId of await approverUnionIds(env.DB, pi)) {
        const messageId = await sendCard(app, unionId, card);
        await env.DB.prepare("INSERT INTO feishuPiCards (id, piId, unionId, messageId) VALUES (?, ?, ?, ?)")
          .bind(id("fpc"), pi.id, unionId, messageId)
          .run();
      }
      return;
    }

    if (pi.status === "APPROVED" || pi.status === "REJECTED") {
      const creator = await first<{ feishuUnionId: string | null }>(env.DB, "SELECT feishuUnionId FROM users WHERE id = ?", pi.createdById);
      if (!creator?.feishuUnionId) return;
      const message = pi.status === "APPROVED"
        ? `${outcome}. The approval chain is complete.`
        : `${outcome}. Fix the PI and submit it again — it restarts at Presales.`;
      await sendCard(app, creator.feishuUnionId, buildPiCard(pi, items, { kind: "info", message }, url));
    }
  } catch (error) {
    console.error("PI Assistant notification failed", args.piId, args.transition, error);
  }
}

async function closeEarlierCards(db: D1Database, app: PiBotApp, pi: PiRow, items: CardItem[], outcome: string, url: string) {
  const cards = await all<{ messageId: string }>(db, "SELECT messageId FROM feishuPiCards WHERE piId = ?", pi.id);
  if (!cards.length) return;
  const closed = buildPiCard(pi, items, { kind: "closed", outcome }, url);
  for (const card of cards) {
    try {
      await patchCard(app, card.messageId, closed);
    } catch (error) {
      console.error("PI Assistant card update failed", card.messageId, error);
    }
  }
  // Closed cards never change again; stop tracking them.
  await db.prepare("DELETE FROM feishuPiCards WHERE piId = ?").bind(pi.id).run();
}
