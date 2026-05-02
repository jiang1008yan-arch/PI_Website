export type Role = "ADMIN" | "USER";
export type Language = "EN" | "ZH";

export type Env = {
  DB: D1Database;
  FILES: R2Bucket;
  JWT_SECRET: string;
  ALLOW_DEFAULT_ADMIN?: string;
  R2_PUBLIC_BASE?: string;
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
