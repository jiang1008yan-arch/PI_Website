import { openApiKey } from "./aiKeys";
import type { AiConfig, AiProvider } from "./aiTriage";
import { first } from "./db";
import type { Env } from "./types";

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
