import { first } from "../../lib/db";
import { signJwt, verifyPassword } from "../../lib/auth";
import { body, createApp } from "./_shared";

export const authRoutes = createApp();

authRoutes.post("/auth/login", async (c) => {
  const data = await body<{ username: string; password: string }>(c);
  const row = await first<any>(c.env.DB, "SELECT * FROM users WHERE username = ?", data.username);
  if (!row || !(await verifyPassword(data.password, row.passwordHash))) {
    return c.json({ error: "Invalid username or password" }, 401);
  }
  const user = { id: row.id, username: row.username, displayName: row.displayName, role: row.role };
  return c.json({ token: await signJwt(c.env, user), user });
});

authRoutes.get("/auth/me", (c) => c.json({ user: c.get("user") }));
