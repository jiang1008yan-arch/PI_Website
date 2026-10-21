import { all, first } from "../db";
import type { AppUser } from "../types";

// One Feishu identity for both bots: users.feishuUnionId (the same in every
// app of the company). users.feishuOpenId is the after-sales bot's per-app id
// from links made before union ids were used; it is only a fallback, and the
// first event from such a person fills in their union id.

export type FeishuIds = { feishuUnionId?: string | null; feishuOpenId?: string | null };
export type FeishuTarget = { type: "union_id" | "open_id"; id: string };

// Where to send a private message to this person, if they are linked.
export function feishuTarget(u: FeishuIds | null | undefined): FeishuTarget | null {
  if (u?.feishuUnionId) return { type: "union_id", id: u.feishuUnionId };
  if (u?.feishuOpenId) return { type: "open_id", id: u.feishuOpenId };
  return null;
}

const USER_COLUMNS = "id, username, displayName, role, feishuUnionId, feishuOpenId";

// The portal user behind a Feishu event (sender or card operator).
export async function userForFeishu(
  db: D1Database,
  ids: { unionId?: string | null; openId?: string | null }
): Promise<AppUser | null> {
  const unionId = ids.unionId || null;
  const openId = ids.openId || null;
  if (unionId) {
    const byUnion = await first<AppUser>(db, `SELECT ${USER_COLUMNS} FROM users WHERE feishuUnionId = ?`, unionId);
    if (byUnion) return byUnion;
  }
  if (!openId) return null;
  const byOpen = await first<AppUser & FeishuIds>(db, `SELECT ${USER_COLUMNS} FROM users WHERE feishuOpenId = ?`, openId);
  if (byOpen && unionId && !byOpen.feishuUnionId) {
    // Upgrade an old after-sales-bot link, unless that union id is already taken.
    await db
      .prepare("UPDATE users SET feishuUnionId = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM users WHERE feishuUnionId = ?)")
      .bind(unionId, byOpen.id, unionId)
      .run();
  }
  return byOpen;
}

// Linked admins: who hears about work whose owner cannot be reached in Feishu.
export async function linkedAdminTargets(db: D1Database): Promise<FeishuTarget[]> {
  const rows = await all<FeishuIds>(
    db,
    "SELECT feishuUnionId, feishuOpenId FROM users WHERE role = 'ADMIN' AND (feishuUnionId IS NOT NULL OR feishuOpenId IS NOT NULL)"
  );
  return rows.map(feishuTarget).filter((t): t is FeishuTarget => t !== null);
}

// Mobile numbers as the Feishu directory expects them: mainland China numbers
// without +86, others with their country code.
export function normalizeMobile(raw: unknown): string | null {
  const value = String(raw ?? "").replace(/[\s()-]/g, "");
  if (!value) return null;
  const cn = value.match(/^(?:\+?86)?(1\d{10})$/);
  if (cn) return cn[1];
  return /^\+\d{6,15}$/.test(value) ? value : null;
}
