import { all, first, id } from "../../lib/db";
import { hashPassword } from "../../lib/auth";
import { admin, body, createApp } from "./_shared";

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

userRoutes.post("/users", async (c) => {
  admin(c);
  const d = await body<any>(c);
  const userId = id("usr");
  await c.env.DB.prepare("INSERT INTO users (id, username, passwordHash, displayName, role) VALUES (?, ?, ?, ?, ?)")
    .bind(userId, d.username, await hashPassword(d.password), d.displayName || d.username, d.role === "ADMIN" ? "ADMIN" : "USER")
    .run();
  return c.json({ id: userId });
});

userRoutes.patch("/users/:id", async (c) => {
  admin(c);
  const targetId = c.req.param("id");
  const d = await body<any>(c);
  if (d.role === "USER") {
    const count = await first<{ count: number }>(
      c.env.DB,
      "SELECT COUNT(*) as count FROM users WHERE role = 'ADMIN' AND id <> ?",
      targetId
    );
    if ((count?.count ?? 0) < 1) return c.json({ error: "Cannot demote the last admin" }, 400);
  }
  await c.env.DB.prepare("UPDATE users SET displayName = COALESCE(?, displayName), role = COALESCE(?, role) WHERE id = ?")
    .bind(d.displayName ?? null, d.role ?? null, targetId)
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
