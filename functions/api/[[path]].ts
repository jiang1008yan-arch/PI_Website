import { Hono } from "hono";
import { cors } from "hono/cors";
import { ensureSeed } from "../lib/seed";
import { verifyJwt } from "../lib/auth";
import type { Env, Variables } from "../lib/types";
import { authRoutes } from "./routes/auth";
import { userRoutes } from "./routes/users";
import { productRoutes } from "./routes/products";
import { optionRoutes } from "./routes/options";
import { templateRoutes } from "./routes/templates";
import { fileRoutes } from "./routes/files";
import { senderProfileRoutes } from "./routes/senderProfile";
import { piRoutes } from "./routes/pi";
import { ticketRoutes } from "./routes/tickets";
import { ticketFieldRoutes } from "./routes/ticketFields";
import { feishuRoutes } from "./routes/feishu";
import { feishuPiRoutes } from "./routes/feishuPi";
import { feishuAuthRoutes } from "./routes/feishuAuth";
import { aiSettingsRoutes } from "./routes/aiSettings";
import { internalRoutes } from "./routes/internal";
import { lookupRoutes } from "./routes/lookup";
import { deviceRoutes } from "./routes/devices";

const app = new Hono<{ Bindings: Env; Variables: Variables }>().basePath("/api");

app.use("*", cors());
app.use("*", async (c, next) => {
  await ensureSeed(c.env);
  try {
    await next();
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(error);
    return c.json({ error: error instanceof Error ? error.message : "Server error" }, 500);
  }
});

app.use("*", async (c, next) => {
  if (c.req.path === "/api/auth/login") return next();
  if (c.req.method === "GET" && c.req.path.startsWith("/api/files/")) return next();
  // Feishu pushes events and card callbacks; the handlers check its signature
  // and verification token instead of a portal login.
  if (c.req.method === "POST" && (c.req.path === "/api/feishu/events" || c.req.path === "/api/feishu/card")) return next();
  // PI Assistant bot pushes (checked against its own keys) and the "Sign in
  // with Feishu" redirects.
  if (c.req.method === "POST" && c.req.path === "/api/feishu/pi/events") return next();
  if (c.req.method === "GET" && c.req.path.startsWith("/api/auth/feishu/")) return next();
  // The cron Worker authenticates with a shared secret (checked in the handler).
  if (c.req.method === "POST" && c.req.path === "/api/internal/cron") return next();
  // The charger backend authenticates with its own shared token (checked in the handler).
  if (c.req.method === "POST" && c.req.path === "/api/devices/status") return next();
  const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return c.json({ error: "Authentication required" }, 401);
  try {
    c.set("user", await verifyJwt(c.env, token));
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
  // Outside the try: a handler's own 403 (e.g. requireAdmin throwing a
  // Response) must not be turned into a 401, which logs the user out.
  await next();
});

app.route("/", authRoutes);
app.route("/", userRoutes);
app.route("/", productRoutes);
app.route("/", optionRoutes);
app.route("/", templateRoutes);
app.route("/", fileRoutes);
app.route("/", senderProfileRoutes);
app.route("/", piRoutes);
app.route("/", ticketRoutes);
app.route("/", ticketFieldRoutes);
app.route("/", feishuRoutes);
app.route("/", feishuPiRoutes);
app.route("/", feishuAuthRoutes);
app.route("/", aiSettingsRoutes);
app.route("/", internalRoutes);
app.route("/", lookupRoutes);
app.route("/", deviceRoutes);

// Exported for the integration tests (functions/test/harness.ts), which drive the
// app directly with a Miniflare-backed D1 instead of going through Pages.
export { app };

export const onRequest: PagesFunction<Env> = (context) =>
  // Pass the EventContext as Hono's ExecutionContext so handlers can defer
  // non-critical work (e.g. draft purge) past the response via c.executionCtx.
  app.fetch(context.request, context.env, context as unknown as ExecutionContext);
