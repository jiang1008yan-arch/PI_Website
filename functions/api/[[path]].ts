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
import { ticketLinkRoutes } from "./routes/ticketLinks";
import { ticketFieldRoutes } from "./routes/ticketFields";
import { publicTicketRoutes } from "./routes/publicTickets";

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
  // 需求2 — public ticket form endpoints are open (token + Turnstile gated
  // inside the handlers), mirroring the login whitelist.
  if (c.req.path.startsWith("/api/public/")) return next();
  if (c.req.method === "GET" && c.req.path.startsWith("/api/files/")) return next();
  const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return c.json({ error: "Authentication required" }, 401);
  try {
    c.set("user", await verifyJwt(c.env, token));
    await next();
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
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
app.route("/", ticketLinkRoutes);
app.route("/", ticketFieldRoutes);
app.route("/", publicTicketRoutes);

export const onRequest: PagesFunction<Env> = (context) =>
  // Pass the EventContext as Hono's ExecutionContext so handlers can defer
  // non-critical work (e.g. draft purge) past the response via c.executionCtx.
  app.fetch(context.request, context.env, context as unknown as ExecutionContext);
