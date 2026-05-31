export type Role = "ADMIN" | "SALES" | "SERVICE";
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
