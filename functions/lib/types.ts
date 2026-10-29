export type Role = "ADMIN" | "SALES" | "SERVICE" | "COMMERCE" | "PRESALES";
export type Language = "EN" | "ZH";

export type Env = {
  DB: D1Database;
  FILES: R2Bucket;
  JWT_SECRET: string;
  ALLOW_DEFAULT_ADMIN?: string;
  R2_PUBLIC_BASE?: string;
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
  // PI Assistant bot — a second self-built app for ZH PI approval cards
  // (functions/lib/feishu/piBot). Unset = that bot is off.
  FEISHU_PI_APP_ID?: string;
  FEISHU_PI_APP_SECRET?: string;
  FEISHU_PI_ENCRYPT_KEY?: string;
  FEISHU_PI_VERIFICATION_TOKEN?: string;
  // Master secret that encrypts users' own AI provider keys (functions/lib/personalAiKey.ts).
  // Without it nobody can save a key and there are no AI suggestions.
  AI_KEY_SECRET?: string;
  // Shared with the cron Worker (workers/cron) that triggers scheduled jobs.
  CRON_SECRET?: string;
  // Shared with the charger backend that pushes device status (POST /api/devices/status).
  DEVICE_INGEST_SECRET?: string;
  // Worker bindings (wrangler.toml): SPA static assets, the `app-jobs` queue
  // producer (Feishu bot jobs), and Workers AI.
  ASSETS: Fetcher;
  JOBS: Queue;
  AI: Ai;
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
