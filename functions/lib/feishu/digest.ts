import { all, first } from "../db";
import { repeatSettings } from "../faultStats";
import type { Env } from "../types";
import { weeklySummaryCard, type WeeklySummary } from "./cards";
import { sendCard, sendText } from "./client";

// Scheduled nudges (run by the cron trigger, see functions/scheduled.ts):
// - each after-sales owner is reminded, in one private message, about open
//   tickets nobody has updated for a day — at most once a day per ticket;
// - the after-sales group gets one summary a week, on Monday from 9:00
//   Beijing time.

export const REMINDER_AFTER_HOURS = 24;
export const WEEKLY_SUMMARY_HOUR_BEIJING = 9; // Monday
const WEEKLY_SENT_KEY = "weeklySummarySentFor";
const HOUR = 60 * 60 * 1000;

const sqlTime = (date: Date) => date.toISOString().slice(0, 19).replace("T", " ");
const parseSqlTime = (value: string) => new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);

export type StaleTicket = { id: string; ticketNo: string; customerCompany: string; updatedAt: string; ownerId: string; ownerOpenId: string };

// One message per owner listing their stale tickets, oldest first.
export function groupReminders(rows: StaleTicket[], now: Date, portalUrl: string | null) {
  const byOwner = new Map<string, StaleTicket[]>();
  for (const row of rows) byOwner.set(row.ownerOpenId, [...(byOwner.get(row.ownerOpenId) ?? []), row]);
  return [...byOwner.entries()].map(([openId, tickets]) => {
    tickets.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    const lines = tickets.map((t) => {
      const hours = Math.floor((now.getTime() - parseSqlTime(t.updatedAt).getTime()) / HOUR);
      const age = hours >= 48 ? `${Math.floor(hours / 24)} days` : `${hours} hours`;
      return `- ${t.ticketNo} (${t.customerCompany || "—"}): no update for ${age}${portalUrl ? ` ${portalUrl}/tickets/${t.id}` : ""}`;
    });
    return {
      openId,
      ticketIds: tickets.map((t) => t.id),
      text: `Reminder: ${tickets.length === 1 ? "this ticket has" : `these ${tickets.length} tickets have`} not been updated for over ${REMINDER_AFTER_HOURS} hours. Please add progress or change the status.\n${lines.join("\n")}`
    };
  });
}

export async function remindStaleOwners(env: Env, now: Date): Promise<number> {
  const cutoff = sqlTime(new Date(now.getTime() - REMINDER_AFTER_HOURS * HOUR));
  const rows = await all<StaleTicket>(
    env.DB,
    `SELECT t.id, t.ticketNo, t.customerCompany, t.updatedAt, t.assignedServiceId AS ownerId, u.feishuOpenId AS ownerOpenId
     FROM tickets t JOIN users u ON u.id = t.assignedServiceId
     WHERE t.status IN ('NEW', 'IN_PROGRESS') AND u.feishuOpenId IS NOT NULL
       AND t.updatedAt < ? AND (t.lastRemindedAt IS NULL OR t.lastRemindedAt < ?)`,
    cutoff,
    cutoff
  );
  const messages = groupReminders(rows, now, env.APP_BASE_URL ?? null);
  for (const m of messages) {
    await sendText(env, "open_id", m.openId, m.text);
    await env.DB.prepare(`UPDATE tickets SET lastRemindedAt = ? WHERE id IN (${m.ticketIds.map(() => "?").join(",")})`)
      .bind(sqlTime(now), ...m.ticketIds)
      .run();
  }
  return messages.length;
}

// The Monday (Beijing date) the summary for `now` belongs to, or null before
// Monday 9:00 Beijing time in the current week's cycle.
export function weeklySummaryKey(now: Date): string | null {
  const beijing = new Date(now.getTime() + 8 * HOUR);
  const day = beijing.getUTCDay(); // 0 = Sunday
  const daysSinceMonday = (day + 6) % 7;
  if (daysSinceMonday === 0 && beijing.getUTCHours() < WEEKLY_SUMMARY_HOUR_BEIJING) return null;
  const monday = new Date(beijing.getTime() - daysSinceMonday * 24 * HOUR);
  return monday.toISOString().slice(0, 10);
}

export async function buildWeeklySummary(env: Env, now: Date): Promise<WeeklySummary> {
  const since = sqlTime(new Date(now.getTime() - 7 * 24 * HOUR));
  const [created, resolved, open, freshRows, settingRows] = await Promise.all([
    first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM tickets WHERE createdAt >= ?", since),
    first<{ n: number }>(env.DB, "SELECT COUNT(DISTINCT ticketId) AS n FROM ticketUpdates WHERE kind = 'STATUS' AND statusTo = 'RESOLVED' AND createdAt >= ?", since),
    all<{ ticketNo: string; customerCompany: string; status: string; createdAt: string; ownerName: string | null }>(
      env.DB,
      `SELECT t.ticketNo, t.customerCompany, t.status, t.createdAt, u.displayName AS ownerName
       FROM tickets t LEFT JOIN users u ON u.id = t.assignedServiceId
       WHERE t.status IN ('NEW', 'IN_PROGRESS') ORDER BY t.createdAt`
    ),
    // Product × fault pairs with a new ticket this week.
    all<{ productName: string | null; faultType: string }>(
      env.DB,
      `SELECT DISTINCT p.nameEn AS productName, t.faultType FROM tickets t LEFT JOIN products p ON p.id = t.productId
       WHERE t.faultType IS NOT NULL AND t.faultType <> '' AND t.productId IS NOT NULL AND t.createdAt >= ?`,
      since
    ),
    all<{ optionKey: string; value: string }>(env.DB, "SELECT optionKey, value FROM appOptions WHERE optionKey IN ('repeatFaultDays', 'repeatFaultThreshold')")
  ]);
  const get = (key: string) => settingRows.find((r) => r.optionKey === key)?.value;
  const settings = repeatSettings(get("repeatFaultDays"), get("repeatFaultThreshold"));
  // Repeat counts over the configured window, for pairs with a new ticket this week.
  const windowStart = sqlTime(new Date(now.getTime() - settings.windowDays * 24 * HOUR));
  const windowCounts = await all<{ productName: string | null; faultType: string; n: number }>(
    env.DB,
    `SELECT p.nameEn AS productName, t.faultType, COUNT(*) AS n FROM tickets t LEFT JOIN products p ON p.id = t.productId
     WHERE t.faultType IS NOT NULL AND t.faultType <> '' AND t.productId IS NOT NULL AND t.createdAt >= ?
     GROUP BY t.productId, t.faultType HAVING COUNT(*) >= ?`,
    windowStart,
    settings.threshold
  );
  const freshPairs = new Set(freshRows.map((r) => `${r.productName}|${r.faultType}`));
  return {
    weekOf: weeklySummaryKey(now) ?? now.toISOString().slice(0, 10),
    created: created?.n ?? 0,
    resolved: resolved?.n ?? 0,
    open: open.map((t) => ({ ...t, ageDays: Math.floor((now.getTime() - parseSqlTime(t.createdAt).getTime()) / (24 * HOUR)) })),
    repeats: windowCounts
      .filter((r) => freshPairs.has(`${r.productName}|${r.faultType}`))
      .map((r) => ({ productName: r.productName ?? "—", faultType: r.faultType, count: r.n, windowDays: settings.windowDays }))
  };
}

export async function sendWeeklySummaryIfDue(env: Env, now: Date): Promise<boolean> {
  const key = weeklySummaryKey(now);
  if (!key) return false;
  const sent = await first<{ value: string }>(env.DB, "SELECT value FROM appOptions WHERE optionKey = ? LIMIT 1", WEEKLY_SENT_KEY);
  if (sent?.value === key) return false;
  const summary = await buildWeeklySummary(env, now);
  await sendCard(env, "chat_id", env.FEISHU_SERVICE_CHAT_ID!, weeklySummaryCard(summary, env.APP_BASE_URL ?? null));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM appOptions WHERE optionKey = ?").bind(WEEKLY_SENT_KEY),
    env.DB.prepare("INSERT INTO appOptions (id, optionKey, value, sortOrder) VALUES (?, ?, ?, 0)").bind(`opt_${WEEKLY_SENT_KEY}`, WEEKLY_SENT_KEY, key)
  ]);
  return true;
}
