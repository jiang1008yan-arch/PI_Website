import { defineConfig } from "drizzle-kit";

declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  dialect: "sqlite",
  schema: "./functions/lib/schema.ts",
  out: "./migrations",
  driver: "d1-http",
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    databaseId: process.env.CLOUDFLARE_DATABASE_ID ?? "",
    token: process.env.CLOUDFLARE_D1_TOKEN ?? ""
  }
});
