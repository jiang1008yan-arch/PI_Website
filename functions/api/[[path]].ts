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

export const onRequest: PagesFunction<Env> = (context) => app.fetch(context.request, context.env);
