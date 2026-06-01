import { first, id } from "./db";
import { hashPassword } from "./auth";
import type { Env } from "./types";

// Seeding is idempotent and only meaningful once. Without this guard every API
// request paid two D1 round-trips (the COUNT + the INSERT OR IGNORE) before its
// real work — a noticeable drag on, e.g., first paint of the PI list. The flag
// lives per worker isolate; a fresh isolate re-runs it once. It is set only
// after success so a failed seed retries on the next request.
let seeded = false;

export async function ensureSeed(env: Env) {
  if (seeded) return;
  const existing = await first<{ count: number }>(env.DB, "SELECT COUNT(*) as count FROM users");
  if ((existing?.count ?? 0) === 0 && env.ALLOW_DEFAULT_ADMIN === "true") {
    await env.DB.prepare("INSERT INTO users (id, username, passwordHash, displayName, role) VALUES (?, ?, ?, ?, ?)")
      .bind(id("usr"), "admin", await hashPassword("Admin@123"), "Master Admin", "ADMIN")
      .run();
  }

  await env.DB.prepare("INSERT OR IGNORE INTO senderProfile (id, corp, address, fromName, phone, email) VALUES (1, '', '', '', '', '')")
    .run();

  seeded = true;
}
