import { Hono } from "hono";
import { requireAdmin } from "../../lib/auth";
import { TicketError } from "../../lib/ticketService";
import type { Env, Variables } from "../../lib/types";

export type AppEnv = { Bindings: Env; Variables: Variables };

// Errors thrown in a route module's handlers reach that module's onError, not
// the parent app's middleware, so the mapping lives here: a TicketError is the
// refusal it describes; anything else is a 500.
export const createApp = () => {
  const app = new Hono<AppEnv>();
  app.onError((error, c) => {
    if (error instanceof TicketError) return c.json({ error: error.message }, error.status);
    console.error(error);
    return c.json({ error: error instanceof Error ? error.message : "Server error" }, 500);
  });
  return app;
};

export const body = async <T>(c: { req: { json: () => Promise<T> } }) => c.req.json();

export const admin = (c: { get: (key: "user") => Variables["user"] }) => requireAdmin(c.get("user"));
