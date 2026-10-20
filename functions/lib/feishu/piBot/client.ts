import type { PiBotApp as FeishuApp } from "./config";

// Feishu Open API client for the PI Assistant bot. Messages are addressed by
// union_id (users.feishuUnionId); also the "Sign in with Feishu" OAuth calls.

const API = "https://open.feishu.cn/open-apis";

type TokenEntry = { token: string; expiresAt: number };
// Per-isolate cache; a tenant token lives ~2h. Refreshing early keeps us clear
// of Feishu's rate limit on the token endpoint (never fetch one per message).
const tokenCache = new Map<string, TokenEntry>();

// Tests swap in a fake Feishu (as setFeishuFetch does for the after-sales bot).
let fetchImpl: typeof fetch = (input, init) => fetch(input, init);
export function setPiBotFetch(impl: typeof fetch | null) {
  fetchImpl = impl ?? ((input, init) => fetch(input, init));
  tokenCache.clear();
}

export class FeishuApiError extends Error {
  constructor(public code: number, message: string) {
    super(`Feishu API ${code}: ${message}`);
  }
}

async function readJson(res: Response): Promise<any> {
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || (typeof data.code === "number" && data.code !== 0)) {
    throw new FeishuApiError(Number(data.code ?? res.status), String(data.msg ?? data.error_description ?? res.statusText));
  }
  return data;
}

export async function tenantToken(app: FeishuApp): Promise<string> {
  const cached = tokenCache.get(app.appId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const data = await readJson(
    await fetchImpl(`${API}/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: app.appId, app_secret: app.appSecret })
    })
  );
  const ttlMs = (Number(data.expire) || 7200) * 1000;
  tokenCache.set(app.appId, { token: data.tenant_access_token, expiresAt: Date.now() + ttlMs - 5 * 60 * 1000 });
  return data.tenant_access_token;
}

async function call(app: FeishuApp, method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetchImpl(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await tenantToken(app)}`,
      "content-type": "application/json; charset=utf-8"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return readJson(res);
}

// Send an interactive card to a user; returns the message_id.
export async function sendCard(app: FeishuApp, unionId: string, card: unknown): Promise<string> {
  const data = await call(app, "POST", "/im/v1/messages?receive_id_type=union_id", {
    receive_id: unionId,
    msg_type: "interactive",
    content: JSON.stringify(card)
  });
  return data.data.message_id;
}

export async function sendText(app: FeishuApp, unionId: string, text: string): Promise<string> {
  const data = await call(app, "POST", "/im/v1/messages?receive_id_type=union_id", {
    receive_id: unionId,
    msg_type: "text",
    content: JSON.stringify({ text })
  });
  return data.data.message_id;
}

// Replace the content of a card the bot sent earlier.
export async function patchCard(app: FeishuApp, messageId: string, card: unknown): Promise<void> {
  await call(app, "PATCH", `/im/v1/messages/${encodeURIComponent(messageId)}`, { content: JSON.stringify(card) });
}

// ── Web sign-in (OAuth) ────────────────────────────────────────────────────

export function authorizeUrl(app: FeishuApp, redirectUri: string, state: string): string {
  const params = new URLSearchParams({ client_id: app.appId, redirect_uri: redirectUri, state });
  return `https://accounts.feishu.cn/open-apis/authen/v1/authorize?${params}`;
}

export type FeishuUserInfo = { unionId: string; openId: string; name: string };

export async function userFromCode(app: FeishuApp, code: string, redirectUri: string): Promise<FeishuUserInfo> {
  const token = await readJson(
    await fetchImpl(`${API}/authen/v2/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: app.appId,
        client_secret: app.appSecret,
        code,
        redirect_uri: redirectUri
      })
    })
  );
  const info = await readJson(
    await fetchImpl(`${API}/authen/v1/user_info`, { headers: { authorization: `Bearer ${token.access_token}` } })
  );
  return { unionId: info.data.union_id, openId: info.data.open_id, name: info.data.name ?? "" };
}
