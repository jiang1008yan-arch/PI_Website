export type Role = "ADMIN" | "SALES" | "SERVICE" | "COMMERCE";
export type Language = "EN" | "ZH";

export type Env = {
  DB: D1Database;
  FILES: R2Bucket;
  JWT_SECRET: string;
  ALLOW_DEFAULT_ADMIN?: string;
  R2_PUBLIC_BASE?: string;
  // 需求2 — Cloudflare Turnstile secret for the public ticket form. When unset
  // (e.g. local dev) verification is skipped; in production it must be set.
  TURNSTILE_SECRET?: string;
  // Public origin of the portal (e.g. https://portal.example.com), used in links
  // the Feishu bot sends.
  APP_BASE_URL?: string;
  // Feishu self-built app (docs/adr/0002-feishu-as-after-sales-work-surface.md).
  // The bot is active only when app id, secret and the after-sales chat are set.
  FEISHU_APP_ID?: string;
  FEISHU_APP_SECRET?: string;
  FEISHU_VERIFICATION_TOKEN?: string;
  FEISHU_ENCRYPT_KEY?: string;
  FEISHU_SERVICE_CHAT_ID?: string;
  // Qwen (Alibaba Cloud Model Studio) key for AI suggestions on "turn into
  // ticket"; optional. QWEN_MODEL overrides the default qwen-plus.
  DASHSCOPE_API_KEY?: string;
  QWEN_MODEL?: string;
};

export type AppUser = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
};

export type Variables = {
  user: AppUser;
};
