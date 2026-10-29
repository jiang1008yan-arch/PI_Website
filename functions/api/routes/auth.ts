import { first } from "../../lib/db";
import { hashPassword, signJwt, verifyPassword, verifyPurposeToken } from "../../lib/auth";
import { FEISHU_BIND } from "./feishuAuth";
import { body, createApp } from "./_shared";

export const authRoutes = createApp();

export function passwordError(password: unknown): string | null {
  if (typeof password !== "string" || password.length < 8) return "Password must be at least 8 characters";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return "Password must contain a letter and a number";
  return null;
}

authRoutes.post("/auth/login", async (c) => {
  const data = await body<{ username: string; password: string; feishuBindToken?: string }>(c);
  const row = await first<any>(c.env.DB, "SELECT * FROM users WHERE username = ?", data.username);
  if (!row || !(await verifyPassword(data.password, row.passwordHash))) {
    return c.json({ error: "Invalid username or password" }, 401);
  }
  // First "Sign in with Feishu": the password proves who this Feishu user is,
  // so link the account; later Feishu sign-ins and PI Assistant card actions
  // resolve to it.
  if (data.feishuBindToken) {
    let unionId: string;
    try {
      ({ unionId } = await verifyPurposeToken<{ unionId: string }>(c.env, FEISHU_BIND, data.feishuBindToken));
    } catch {
      return c.json({ error: "The Feishu link expired. Use Sign in with Feishu again." }, 400);
    }
    const taken = await first<{ id: string }>(c.env.DB, "SELECT id FROM users WHERE feishuUnionId = ? AND id <> ?", unionId, row.id);
    if (taken) return c.json({ error: "This Feishu account is already linked to another user." }, 400);
    await c.env.DB.prepare("UPDATE users SET feishuUnionId = ? WHERE id = ?").bind(unionId, row.id).run();
  }
  const user = { id: row.id, username: row.username, displayName: row.displayName, role: row.role };
  return c.json({ token: await signJwt(c.env, user), user });
});

authRoutes.get("/auth/me", (c) => c.json({ user: c.get("user") }));

authRoutes.post("/auth/change-password", async (c) => {
  const user = c.get("user");
  const d = await body<{ currentPassword?: string; newPassword?: string }>(c);
  const row = await first<any>(c.env.DB, "SELECT passwordHash FROM users WHERE id = ?", user.id);
  if (!row || !(await verifyPassword(d.currentPassword ?? "", row.passwordHash))) {
    return c.json({ error: "Current password is incorrect" }, 400);
  }
  const err = passwordError(d.newPassword);
  if (err) return c.json({ error: err }, 400);
  await c.env.DB.prepare("UPDATE users SET passwordHash = ? WHERE id = ?")
    .bind(await hashPassword(d.newPassword as string), user.id)
    .run();
  return c.json({ ok: true });
});
