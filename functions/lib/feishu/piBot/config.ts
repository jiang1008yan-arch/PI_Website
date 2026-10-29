import type { Env } from "../../types";

// The PI Assistant bot: a second Feishu self-built app, separate from the
// after-sales bot (FEISHU_APP_ID, functions/lib/feishu/client.ts). It sends ZH
// PI approval cards to the picked approvers and takes Approve / Reject from the
// card. People are addressed by union_id — the same for one person across all
// of the company's Feishu apps — stored in users.feishuUnionId.
export type PiBotApp = {
  bot: "pi";
  appId: string;
  appSecret: string;
  encryptKey: string;
  verificationToken: string;
};

// Null when the bot is not configured in this environment.
export function piBotApp(env: Env): PiBotApp | null {
  const appId = String(env.FEISHU_PI_APP_ID ?? "").trim();
  const appSecret = String(env.FEISHU_PI_APP_SECRET ?? "").trim();
  if (!appId || !appSecret) return null;
  return {
    bot: "pi",
    appId,
    appSecret,
    encryptKey: String(env.FEISHU_PI_ENCRYPT_KEY ?? "").trim(),
    verificationToken: String(env.FEISHU_PI_VERIFICATION_TOKEN ?? "").trim()
  };
}
