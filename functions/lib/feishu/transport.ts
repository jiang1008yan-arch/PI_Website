// One Feishu Open Platform transport for both bots: the after-sales bot
// (feishu/client.ts) and the PI Assistant (piBot/client.ts) are two apps over
// it. It holds the tenant tokens, the request and the error rule; each bot's
// client only knows its own endpoints. Tests replace the fetch per bot.

const BASE = "https://open.feishu.cn/open-apis";

export type FeishuBot = "afterSales" | "pi";
export type FeishuApp = { bot: FeishuBot; appId: string; appSecret: string };

export class FeishuApiError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

const fetchOverrides = new Map<FeishuBot, typeof fetch>();
const fetchFor = (bot: FeishuBot): typeof fetch => fetchOverrides.get(bot) ?? ((input, init) => fetch(input, init));

// Per-isolate cache; a tenant token lives ~2h. Refreshing 5 minutes early
// keeps us clear of Feishu's rate limit on the token endpoint (never one per message).
const tokens = new Map<string, { token: string; expiresAt: number }>();
const tokenKey = (app: FeishuApp) => `${app.bot}:${app.appId}`;

// A fake Feishu for one bot (null: the real one again); its tokens are dropped.
export function setBotFetch(bot: FeishuBot, impl: typeof fetch | null) {
  if (impl) fetchOverrides.set(bot, impl);
  else fetchOverrides.delete(bot);
  for (const key of [...tokens.keys()]) if (key.startsWith(`${bot}:`)) tokens.delete(key);
}

// Feishu answers { code, msg, … }; anything but code 0 (or an HTTP error) is a FeishuApiError.
async function readJson(res: Response, label: string): Promise<any> {
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || (data.code !== undefined && data.code !== 0)) {
    const code = Number(data.code ?? res.status);
    throw new FeishuApiError(code, `${label}: ${code} ${data.msg ?? data.error_description ?? res.statusText}`);
  }
  return data;
}

async function tenantToken(app: FeishuApp): Promise<string> {
  const cached = tokens.get(tokenKey(app));
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const res = await fetchFor(app.bot)(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: app.appId, app_secret: app.appSecret })
  });
  const data = await readJson(res, "Feishu token");
  if (!data.tenant_access_token) throw new FeishuApiError(Number(data.code ?? 0), `Feishu token: ${data.code} ${data.msg}`);
  const ttlMs = (Number(data.expire) || 7200) * 1000;
  tokens.set(tokenKey(app), { token: data.tenant_access_token, expiresAt: Date.now() + ttlMs - 5 * 60 * 1000 });
  return data.tenant_access_token;
}

// An Open API call; returns Feishu's whole answer ({ code, data, … }). Signed
// with the app's tenant token, unless `bearer` gives another token (a user's,
// for sign-in) or null (no token: the sign-in code exchange).
export async function call(app: FeishuApp, method: string, path: string, body?: unknown, bearer?: string | null): Promise<any> {
  const token = bearer === undefined ? await tenantToken(app) : bearer;
  const res = await fetchFor(app.bot)(`${BASE}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json; charset=utf-8" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return await readJson(res, `Feishu ${method} ${path}`);
}

// A file download: the raw response, for the caller to stream or reject.
export async function download(app: FeishuApp, path: string): Promise<Response> {
  return await fetchFor(app.bot)(`${BASE}${path}`, { headers: { authorization: `Bearer ${await tenantToken(app)}` } });
}
