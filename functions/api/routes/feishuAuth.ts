import { first } from "../../lib/db";
import { signJwt, signPurposeToken, verifyPurposeToken } from "../../lib/auth";
import { authorizeUrl, userFromCode } from "../../lib/feishu/piBot/client";
import { piBotApp } from "../../lib/feishu/piBot/config";
import { siteBase } from "../../lib/feishu/piBot/notifyPi";
import { createApp } from "./_shared";

// "Sign in with Feishu", through the PI Assistant app (its union_id is the
// same for a person in every company app). Unauthenticated (whitelisted in
// [[path]].ts).
//
// start    → redirect to Feishu's authorize page (silent inside the Feishu app)
// callback → Feishu union_id → linked user? hand the SPA a session token;
//            otherwise hand it a short-lived bind token: the user signs in once
//            with username + password and POST /auth/login links the account.
// Tokens travel in the URL fragment, which browsers never send to servers.

export const feishuAuthRoutes = createApp();

export const FEISHU_STATE = "feishu-state";
export const FEISHU_BIND = "feishu-bind";

// Only same-site paths may be used as the post-login destination.
function safeNext(next: unknown): string {
  const value = String(next ?? "/");
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

feishuAuthRoutes.get("/auth/feishu/start", async (c) => {
  const app = piBotApp(c.env);
  if (!app) return c.text("Feishu sign-in is not configured", 503);
  const base = siteBase(c.env, c.req.url);
  const state = await signPurposeToken(c.env, FEISHU_STATE, { next: safeNext(c.req.query("next")) }, "10m");
  return c.redirect(authorizeUrl(app, `${base}/api/auth/feishu/callback`, state));
});

feishuAuthRoutes.get("/auth/feishu/callback", async (c) => {
  const base = siteBase(c.env, c.req.url);
  const fail = (message: string) => c.redirect(`${base}/login#feishuError=${encodeURIComponent(message)}`);
  let state: { next: string };
  try {
    state = await verifyPurposeToken(c.env, FEISHU_STATE, c.req.query("state") ?? "");
  } catch {
    return fail("The Feishu sign-in link expired. Please try again.");
  }
  const app = piBotApp(c.env);
  const code = c.req.query("code");
  if (!app || !code) return fail("Feishu sign-in was cancelled.");

  let feishuUser;
  try {
    feishuUser = await userFromCode(app, code, `${base}/api/auth/feishu/callback`);
  } catch (error) {
    console.error("Feishu OAuth failed", error);
    return fail("Feishu sign-in failed. Please try again.");
  }

  const next = safeNext(state.next);
  const row = await first<any>(c.env.DB, "SELECT * FROM users WHERE feishuUnionId = ?", feishuUser.unionId);
  if (row) {
    const user = { id: row.id, username: row.username, displayName: row.displayName, role: row.role };
    const token = await signJwt(c.env, user);
    return c.redirect(`${base}/login#feishuToken=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`);
  }
  const bind = await signPurposeToken(c.env, FEISHU_BIND, { unionId: feishuUser.unionId, name: feishuUser.name }, "15m");
  return c.redirect(
    `${base}/login#feishuBind=${encodeURIComponent(bind)}&name=${encodeURIComponent(feishuUser.name)}&next=${encodeURIComponent(next)}`
  );
});
