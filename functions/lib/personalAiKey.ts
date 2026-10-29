import type { AiConfig, AiProvider } from "./aiTriage";
import { first } from "./db";
import type { Env } from "./types";

// A user's Personal AI key (CONTEXT.md): their own Qwen or DeepSeek key, the
// only writer and reader of userAiSettings. The master secret (AI_KEY_SECRET)
// is a server secret kept apart from the database; each key is sealed with
// AES-256-GCM under a fresh IV and bound to its user id as additional data, so
// a ciphertext copied onto another user's row will not decrypt. Keys are only
// decrypted at the moment an AI request is made.

const encoder = new TextEncoder();

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));

async function masterKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode("pi-website-ai-keys"), info: encoder.encode("user-ai-key-v1") },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export type SealedKey = { cipher: string; iv: string };

export async function sealApiKey(secret: string, userId: string, apiKey: string): Promise<SealedKey> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(userId) },
    await masterKey(secret),
    encoder.encode(apiKey)
  );
  return { cipher: toBase64(new Uint8Array(cipher)), iv: toBase64(iv) };
}

// Throws if the secret, the user id or the ciphertext does not match.
export async function openApiKey(secret: string, userId: string, sealed: SealedKey): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(sealed.iv), additionalData: encoder.encode(userId) },
    await masterKey(secret),
    fromBase64(sealed.cipher)
  );
  return new TextDecoder().decode(plain);
}

// What the portal shows instead of the key.
export function maskApiKey(last4: string): string {
  return `sk-****${last4}`;
}

// ── Stored keys ────────────────────────────────────────────────────────────

export type UserAiRow = {
  userId: string;
  provider: AiProvider;
  apiKeyCipher: string;
  apiKeyIv: string;
  apiKeyLast4: string;
  model: string | null;
  updatedAt: string;
};

export async function loadUserAiRow(db: D1Database, userId: string): Promise<UserAiRow | null> {
  return await first<UserAiRow>(db, "SELECT * FROM userAiSettings WHERE userId = ?", userId);
}

// The user's own AI configuration with the key decrypted, or null when they
// have none (or it can no longer be decrypted, e.g. after the secret changed).
export async function loadUserAiConfig(env: Env, userId: string): Promise<AiConfig | null> {
  if (!env.AI_KEY_SECRET) return null;
  const row = await loadUserAiRow(env.DB, userId);
  if (!row) return null;
  try {
    const apiKey = await openApiKey(env.AI_KEY_SECRET, userId, { cipher: row.apiKeyCipher, iv: row.apiKeyIv });
    return { provider: row.provider, apiKey, model: row.model };
  } catch {
    console.error("AI key could not be decrypted for a user; they need to enter it again");
    return null;
  }
}

// Seals and saves the key (it has been checked with the provider); returns
// what the portal shows instead of it.
export async function saveUserAiKey(secret: string, db: D1Database, userId: string, config: AiConfig): Promise<string> {
  const sealed = await sealApiKey(secret, userId, config.apiKey);
  const last4 = config.apiKey.slice(-4);
  await db
    .prepare(
      `INSERT INTO userAiSettings (userId, provider, apiKeyCipher, apiKeyIv, apiKeyLast4, model, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(userId) DO UPDATE SET provider = excluded.provider, apiKeyCipher = excluded.apiKeyCipher, apiKeyIv = excluded.apiKeyIv,
         apiKeyLast4 = excluded.apiKeyLast4, model = excluded.model, updatedAt = excluded.updatedAt`
    )
    .bind(userId, config.provider, sealed.cipher, sealed.iv, last4, config.model ?? null)
    .run();
  return maskApiKey(last4);
}

export async function removeUserAiKey(db: D1Database, userId: string) {
  await db.prepare("DELETE FROM userAiSettings WHERE userId = ?").bind(userId).run();
}
