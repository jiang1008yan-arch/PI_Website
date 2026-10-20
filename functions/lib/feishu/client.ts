import type { Env } from "../types";

// Minimal Feishu Open Platform client: tenant token, send/reply/update
// messages, read a message. Everything goes through `feishuFetch`, which tests
// replace with a fake.

const BASE = "https://open.feishu.cn/open-apis";

let fetchImpl: typeof fetch = (input, init) => fetch(input, init);
export function setFeishuFetch(impl: typeof fetch | null) {
  fetchImpl = impl ?? ((input, init) => fetch(input, init));
  tokenCache = null;
}

export function feishuEnabled(env: Env): boolean {
  return Boolean(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET && env.FEISHU_SERVICE_CHAT_ID);
}

let tokenCache: { appId: string; value: string; expiresAt: number } | null = null;

async function tenantToken(env: Env): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.appId === env.FEISHU_APP_ID && tokenCache.expiresAt > now + 60_000) return tokenCache.value;
  const res = await fetchImpl(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET })
  });
  const data: any = await res.json();
  if (data.code !== 0 || !data.tenant_access_token) throw new Error(`Feishu token: ${data.code} ${data.msg}`);
  tokenCache = { appId: env.FEISHU_APP_ID!, value: data.tenant_access_token, expiresAt: now + Number(data.expire ?? 3600) * 1000 };
  return tokenCache.value;
}

async function call(env: Env, method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetchImpl(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${await tenantToken(env)}`, "content-type": "application/json; charset=utf-8" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data: any = await res.json().catch(() => ({}));
  if (data.code !== 0) throw new Error(`Feishu ${method} ${path}: ${data.code} ${data.msg}`);
  return data.data ?? {};
}

export type ReceiveIdType = "chat_id" | "open_id";

export async function sendCard(env: Env, type: ReceiveIdType, receiveId: string, card: unknown): Promise<string> {
  const data = await call(env, "POST", `/im/v1/messages?receive_id_type=${type}`, {
    receive_id: receiveId,
    msg_type: "interactive",
    content: JSON.stringify(card)
  });
  return String(data.message_id ?? "");
}

export async function sendText(env: Env, type: ReceiveIdType, receiveId: string, text: string): Promise<string> {
  const data = await call(env, "POST", `/im/v1/messages?receive_id_type=${type}`, {
    receive_id: receiveId,
    msg_type: "text",
    content: JSON.stringify({ text })
  });
  return String(data.message_id ?? "");
}

export async function replyText(env: Env, messageId: string, text: string): Promise<void> {
  await call(env, "POST", `/im/v1/messages/${encodeURIComponent(messageId)}/reply`, { msg_type: "text", content: JSON.stringify({ text }) });
}

// Cards sent with config.update_multi = true can be updated in place for everyone.
export async function updateCard(env: Env, messageId: string, card: unknown): Promise<void> {
  await call(env, "PATCH", `/im/v1/messages/${encodeURIComponent(messageId)}`, { content: JSON.stringify(card) });
}

// Bitable (the requirement pool). The bot must be an editor of the base.
export async function listBitableFields(env: Env, appToken: string, tableId: string): Promise<{ field_name: string; type: number }[]> {
  const data = await call(env, "GET", `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields?page_size=100`);
  return data.items ?? [];
}

export async function addBitableRecord(env: Env, appToken: string, tableId: string, fields: Record<string, string>): Promise<string> {
  const data = await call(env, "POST", `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records`, { fields });
  return String(data.record?.record_id ?? "");
}

export async function getMessageText(env: Env, messageId: string): Promise<string> {
  const data = await call(env, "GET", `/im/v1/messages/${encodeURIComponent(messageId)}`);
  const item = data.items?.[0];
  return item ? messageContentToText(item.msg_type, item.body?.content) : "";
}

// Plain text out of a message's JSON content: text messages and rich-text
// ("post") messages; @-mention placeholders (@_user_1) are dropped.
export function messageContentToText(msgType: string, content: unknown): string {
  let parsed: any = content;
  if (typeof content === "string") {
    try {
      parsed = JSON.parse(content);
    } catch {
      return "";
    }
  }
  let text = "";
  if (msgType === "text") text = String(parsed?.text ?? "");
  else if (msgType === "post") {
    const post = parsed?.content ? parsed : parsed?.zh_cn ?? parsed?.en_us ?? Object.values(parsed ?? {})[0];
    const lines: string[] = [];
    if (post?.title) lines.push(String(post.title));
    for (const line of post?.content ?? []) {
      lines.push((line as any[]).map((seg) => (seg?.tag === "text" || seg?.tag === "a" ? String(seg.text ?? "") : "")).join(""));
    }
    text = lines.join("\n");
  }
  return text.replace(/@_user_\d+/g, "").replace(/[ \t]+/g, " ").trim();
}
