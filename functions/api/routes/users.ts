import { all, first, id } from "../../lib/db";
import { hashPassword } from "../../lib/auth";
import type { Role } from "../../lib/types";
import { admin, body, createApp } from "./_shared";
import { passwordError } from "./auth";

const ROLES: Role[] = ["ADMIN", "SALES", "SERVICE"];
const normalizeRole = (value: unknown): Role => (ROLES.includes(value as Role) ? (value as Role) : "SALES");

export const userRoutes = createApp();

userRoutes.get("/users", async (c) => {
  admin(c);
  return c.json(await all(c.env.DB, "SELECT id, username, displayName, role, createdAt FROM users ORDER BY createdAt DESC"));
});

userRoutes.get("/review-recipients", async (c) => {
  return c.json(
    await all(c.env.DB, "SELECT id, username, displayName, role FROM users WHERE role = 'ADMIN' ORDER BY displayName, username")
  );
});

// Minimal roster for assignee pickers (ticket links, manual tickets, assignee
// panel). Available to any authenticated user — no password/username exposed.
userRoutes.get("/assignable-users", async (c) => {
  return c.json(
    await all(
      c.env.DB,
      "SELECT id, displayName, role FROM users WHERE role IN ('ADMIN','SALES','SERVICE') ORDER BY role, displayName"
    )
  );
});

userRoutes.post("/users", async (c) => {
  admin(c);
  const d = await body<any>(c);
  const userId = id("usr");
  await c.env.DB.prepare("INSERT INTO users (id, username, passwordHash, displayName, role) VALUES (?, ?, ?, ?, ?)")
    .bind(userId, d.username, await hashPassword(d.password), d.displayName || d.username, normalizeRole(d.role))
    .run();
  return c.json({ id: userId });
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
