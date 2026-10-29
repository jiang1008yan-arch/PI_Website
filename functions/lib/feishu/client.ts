import type { Env } from "../types";
import { call as transportCall, download, setBotFetch, type FeishuApp } from "./transport";

// The after-sales bot's Feishu client (FEISHU_APP_ID), over the shared
// transport: send/reply/update messages, read a message and download its
// files, list the bot's groups, the requirement-pool Bitable.

// Tests replace this bot's Feishu with a fake.
export const setFeishuFetch = (impl: typeof fetch | null) => setBotFetch("afterSales", impl);

export function feishuEnabled(env: Env): boolean {
  return Boolean(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET && env.FEISHU_SERVICE_CHAT_ID);
}

const app = (env: Env): FeishuApp => ({ bot: "afterSales", appId: env.FEISHU_APP_ID ?? "", appSecret: env.FEISHU_APP_SECRET ?? "" });

// The `data` part of Feishu's answer.
async function call(env: Env, method: string, path: string, body?: unknown): Promise<any> {
  return (await transportCall(app(env), method, path, body)).data ?? {};
}

export type ReceiveIdType = "chat_id" | "open_id" | "union_id";

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

// A message as the "get message" API returns it. For a merged forward the
// list is the forward itself followed by its sub-messages (upper_message_id).
export type FeishuMessageItem = {
  message_id: string;
  msg_type: string;
  chat_id?: string;
  upper_message_id?: string;
  create_time?: string;
  body?: { content?: string };
};

export async function getMessageItems(env: Env, messageId: string): Promise<FeishuMessageItem[]> {
  const data = await call(env, "GET", `/im/v1/messages/${encodeURIComponent(messageId)}`);
  return data.items ?? [];
}

export type Download = { ok: true; body: ArrayBuffer; contentType: string } | { ok: false; tooLarge: boolean; size: number | null; error?: string };

// A picture ("image") or voice message / video / file ("file") of a message
// the bot can see. Feishu refuses files inside merged forwards (234043).
export async function downloadResource(env: Env, messageId: string, fileKey: string, type: "image" | "file", maxBytes: number): Promise<Download> {
  const res = await download(app(env), `/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(fileKey)}?type=${type}`);
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  if (!res.ok || contentType.includes("application/json")) {
    const data: any = await res.json().catch(() => ({}));
    return { ok: false, tooLarge: false, size: null, error: `${data.code ?? res.status} ${data.msg ?? ""}`.trim() };
  }
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    await res.body?.cancel();
    return { ok: false, tooLarge: true, size: declared };
  }
  const body = await res.arrayBuffer();
  if (body.byteLength > maxBytes) return { ok: false, tooLarge: true, size: body.byteLength };
  return { ok: true, body, contentType };
}

// Groups the bot is in (the customer groups a ticket can report back to).
export async function listBotChats(env: Env): Promise<{ chatId: string; name: string }[]> {
  const chats: { chatId: string; name: string }[] = [];
  let pageToken = "";
  for (let page = 0; page < 5; page++) {
    const data = await call(env, "GET", `/im/v1/chats?page_size=100${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`);
    for (const item of data.items ?? []) if (item.chat_id) chats.push({ chatId: String(item.chat_id), name: String(item.name ?? "") || String(item.chat_id) });
    if (!data.has_more || !data.page_token) break;
    pageToken = String(data.page_token);
  }
  return chats;
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
