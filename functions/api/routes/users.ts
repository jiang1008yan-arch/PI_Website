import { all, first, id } from "../../lib/db";
import { hashPassword } from "../../lib/auth";
import { normalizeMobile } from "../../lib/feishu/identity";
import { unionIdForMobile } from "../../lib/feishu/piBot/client";
import { piBotApp } from "../../lib/feishu/piBot/config";
import type { Env, Role } from "../../lib/types";
import { admin, body, createApp } from "./_shared";
import { passwordError } from "./auth";

const ROLES: Role[] = ["ADMIN", "SALES", "SERVICE", "COMMERCE", "PRESALES"];
const normalizeRole = (value: unknown): Role => (ROLES.includes(value as Role) ? (value as Role) : "SALES");

export const userRoutes = createApp();

const FEISHU_LINKED = "(feishuUnionId IS NOT NULL OR feishuOpenId IS NOT NULL)";

export type FeishuLinkResult = { status: "linked" | "not_found" | "taken" | "unavailable" | "error"; message: string };

// Links a user's Feishu account from the mobile number an admin entered, via
// the Feishu directory. Never matches on names.
async function linkByMobile(env: Env, userId: string, mobile: string): Promise<FeishuLinkResult> {
  const app = piBotApp(env);
  if (!app) return { status: "unavailable", message: "Feishu is not configured, so the account was not linked." };
  let unionId: string | null;
  try {
    unionId = await unionIdForMobile(app, mobile);
  } catch (error) {
    console.error("Feishu mobile lookup failed", error);
    return {
      status: "error",
      message: "Feishu lookup failed. Check that the PI Assistant app has the \"obtain user ID via email or mobile number\" permission and that its contacts range covers this person."
    };
  }
  if (!unionId) return { status: "not_found", message: "No Feishu member has this mobile number (or they are outside the app's contacts range)." };
  const holder = await first<{ id: string; displayName: string }>(env.DB, "SELECT id, displayName FROM users WHERE feishuUnionId = ? AND id <> ?", unionId, userId);
  if (holder) return { status: "taken", message: `That Feishu account is already linked to ${holder.displayName}. Unlink it there first.` };
  // A different Feishu person than before: drop the old after-sales-bot id too.
  await env.DB.prepare(
    "UPDATE users SET feishuOpenId = CASE WHEN feishuUnionId IS NOT ? THEN NULL ELSE feishuOpenId END, feishuUnionId = ? WHERE id = ?"
  )
    .bind(unionId, unionId, userId)
    .run();
  return { status: "linked", message: "Linked to Feishu." };
}

userRoutes.get("/users", async (c) => {
  admin(c);
  return c.json(
    await all(c.env.DB, `SELECT id, username, displayName, role, mobile, ${FEISHU_LINKED} AS feishuLinked, createdAt FROM users ORDER BY createdAt DESC`)
  );
});

// Approver candidates for a ZH PI submission: the Presales picker lists
// PRESALES users (and admins), the Commerce picker lists COMMERCE users.
userRoutes.get("/review-recipients", async (c) => {
  return c.json(
    await all(
      c.env.DB,
      `SELECT id, username, displayName, role, ${FEISHU_LINKED} AS feishuLinked FROM users WHERE role IN ('PRESALES', 'ADMIN', 'COMMERCE') ORDER BY displayName, username`
    )
  );
});

// Minimal roster for assignee pickers (ticket links, manual tickets, assignee
// panel). Available to any authenticated user — no password/username exposed.
userRoutes.get("/assignable-users", async (c) => {
  return c.json(
    await all(
      c.env.DB,
      `SELECT id, displayName, role, ${FEISHU_LINKED} AS feishuLinked FROM users WHERE role IN ('ADMIN','SALES','SERVICE') ORDER BY role, displayName`
    )
  );
});

// "" or null clears the number; anything else must look like a phone number.
function mobileInput(value: unknown): { ok: true; mobile: string | null } | { ok: false } {
  if (value == null || String(value).trim() === "") return { ok: true, mobile: null };
  const mobile = normalizeMobile(value);
  return mobile ? { ok: true, mobile } : { ok: false };
}
const MOBILE_ERROR = "Enter a mainland China mobile number, or another number with its country code (e.g. +44…).";

userRoutes.post("/users", async (c) => {
  admin(c);
  const d = await body<any>(c);
  const mobile = mobileInput(d.mobile);
  if (!mobile.ok) return c.json({ error: MOBILE_ERROR }, 400);
  const userId = id("usr");
  await c.env.DB.prepare("INSERT INTO users (id, username, passwordHash, displayName, role, mobile) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(userId, d.username, await hashPassword(d.password), d.displayName || d.username, normalizeRole(d.role), mobile.mobile)
    .run();
  const feishu = mobile.mobile ? await linkByMobile(c.env, userId, mobile.mobile) : null;
  return c.json({ id: userId, feishu });
});

userRoutes.patch("/users/:id", async (c) => {
  admin(c);
  const targetId = c.req.param("id");
  const d = await body<any>(c);
  const nextRole = d.role == null ? null : normalizeRole(d.role);
  if (nextRole != null && nextRole !== "ADMIN") {
    const count = await first<{ count: number }>(
      c.env.DB,
      "SELECT COUNT(*) as count FROM users WHERE role = 'ADMIN' AND id <> ?",
      targetId
    );
    if ((count?.count ?? 0) < 1) return c.json({ error: "Cannot demote the last admin" }, 400);
  }
  await c.env.DB.prepare("UPDATE users SET displayName = COALESCE(?, displayName), role = COALESCE(?, role) WHERE id = ?")
    .bind(d.displayName ?? null, nextRole, targetId)
    .run();
  // A new mobile number re-links the account from the Feishu directory.
  let feishu: FeishuLinkResult | null = null;
  if (d.mobile !== undefined) {
    const mobile = mobileInput(d.mobile);
    if (!mobile.ok) return c.json({ error: MOBILE_ERROR }, 400);
    await c.env.DB.prepare("UPDATE users SET mobile = ? WHERE id = ?").bind(mobile.mobile, targetId).run();
    if (mobile.mobile) feishu = await linkByMobile(c.env, targetId, mobile.mobile);
  }
  return c.json({ ok: true, feishu });
});

// Try the saved mobile number again (e.g. after the person joined Feishu).
userRoutes.post("/users/:id/feishu-link", async (c) => {
  admin(c);
  const target = await first<{ mobile: string | null }>(c.env.DB, "SELECT mobile FROM users WHERE id = ?", c.req.param("id"));
  if (!target) return c.json({ error: "User not found" }, 404);
  if (!target.mobile) return c.json({ error: "Add the person's Feishu mobile number first." }, 400);
  return c.json({ feishu: await linkByMobile(c.env, c.req.param("id"), target.mobile) });
});

// Remove the Feishu link (both bots); the person can link again by signing in with Feishu.
userRoutes.delete("/users/:id/feishu-link", async (c) => {
  admin(c);
  await c.env.DB.prepare("UPDATE users SET feishuUnionId = NULL, feishuOpenId = NULL WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

userRoutes.post("/users/:id/reset-password", async (c) => {
  admin(c);
  const targetId = c.req.param("id");
  const d = await body<{ newPassword?: string }>(c);
  const err = passwordError(d.newPassword);
  if (err) return c.json({ error: err }, 400);
  const target = await first<{ id: string }>(c.env.DB, "SELECT id FROM users WHERE id = ?", targetId);
  if (!target) return c.json({ error: "User not found" }, 404);
  await c.env.DB.prepare("UPDATE users SET passwordHash = ? WHERE id = ?")
    .bind(await hashPassword(d.newPassword as string), targetId)
    .run();
  return c.json({ ok: true });
});

userRoutes.delete("/users/:id", async (c) => {
  admin(c);
  const targetId = c.req.param("id");
  const target = await first<any>(c.env.DB, "SELECT role FROM users WHERE id = ?", targetId);
  if (target?.role === "ADMIN") {
    const count = await first<{ count: number }>(
      c.env.DB,
      "SELECT COUNT(*) as count FROM users WHERE role = 'ADMIN' AND id <> ?",
      targetId
    );
    if ((count?.count ?? 0) < 1) return c.json({ error: "Cannot delete the last admin" }, 400);
  }
  await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(targetId).run();
  return c.json({ ok: true });
});
