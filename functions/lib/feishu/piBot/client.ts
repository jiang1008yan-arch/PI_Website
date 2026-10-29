import { call, setBotFetch } from "../transport";
import type { PiBotApp as FeishuApp } from "./config";

// Feishu Open API client for the PI Assistant bot, over the shared transport.
// Messages are addressed by union_id (users.feishuUnionId); also the "Sign in
// with Feishu" OAuth calls.

// Tests swap in a fake Feishu (as setFeishuFetch does for the after-sales bot).
export const setPiBotFetch = (impl: typeof fetch | null) => setBotFetch("pi", impl);

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
  const token = await call(
    app,
    "POST",
    "/authen/v2/oauth/token",
    { grant_type: "authorization_code", client_id: app.appId, client_secret: app.appSecret, code, redirect_uri: redirectUri },
    null
  );
  const info = await call(app, "GET", "/authen/v1/user_info", undefined, token.access_token);
  return { unionId: info.data.union_id, openId: info.data.open_id, name: info.data.name ?? "" };
}

// The Feishu directory's union id for a mobile number (null: no such active
// member, or outside the app's contacts range). Needs the
// contact:user.id:readonly permission ("obtain user ID via email or mobile").
export async function unionIdForMobile(app: FeishuApp, mobile: string): Promise<string | null> {
  const data = await call(app, "POST", "/contact/v3/users/batch_get_id?user_id_type=union_id", {
    mobiles: [mobile],
    include_resigned: false
  });
  const match = (data.data?.user_list ?? []).find((u: any) => u.user_id);
  return match ? String(match.user_id) : null;
}
