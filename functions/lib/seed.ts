import { first, id } from "./db";
import { hashPassword } from "./auth";
import type { Env } from "./types";

export async function ensureSeed(env: Env) {
  const existing = await first<{ count: number }>(env.DB, "SELECT COUNT(*) as count FROM users");
  if ((existing?.count ?? 0) === 0 && env.ALLOW_DEFAULT_ADMIN === "true") {
    await env.DB.prepare("INSERT INTO users (id, username, passwordHash, displayName, role) VALUES (?, ?, ?, ?, ?)")
      .bind(id("usr"), "admin", await hashPassword("Admin@123"), "Master Admin", "ADMIN")
      .run();
  }

  await env.DB.prepare("INSERT OR IGNORE INTO senderProfile (id, corp, address, fromName, phone, email) VALUES (1, '', '', '', '', '')")
    .run();
}
