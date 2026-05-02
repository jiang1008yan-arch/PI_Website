import { Hono } from "hono";
import { requireAdmin } from "../../lib/auth";
import type { Env, Variables } from "../../lib/types";

export type AppEnv = { Bindings: Env; Variables: Variables };

export const createApp = () => new Hono<AppEnv>();

export const body = async <T>(c: { req: { json: () => Promise<T> } }) => c.req.json();

export const admin = (c: { get: (key: "user") => Variables["user"] }) => requireAdmin(c.get("user"));
