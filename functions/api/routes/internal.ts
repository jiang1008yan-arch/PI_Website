import { runScheduledJobs } from "../../scheduled";
import { createApp } from "./_shared";

// Called by the cron Worker (workers/cron) every 30 minutes with the shared
// CRON_SECRET; there is no portal login on this route.

export const internalRoutes = createApp();

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

internalRoutes.post("/internal/cron", async (c) => {
  const secret = c.env.CRON_SECRET;
  const given = c.req.header("x-cron-secret") ?? "";
  if (!secret || !sameSecret(given, secret)) return c.json({ error: "Forbidden" }, 401);
  return c.json({ ok: true, jobs: await runScheduledJobs(c.env, new Date()) });
});
