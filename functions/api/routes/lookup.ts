import { lookup, type LookupKind } from "../../lib/lookup";
import { canUseTickets } from "../../lib/ticketAccess";
import { createApp } from "./_shared";

// Type-ahead for production order numbers, customer names and device SNs
// (functions/lib/lookup.ts). Same audience as tickets.

export const lookupRoutes = createApp();

const KINDS: LookupKind[] = ["all", "order", "customer", "sn"];

lookupRoutes.get("/lookup", async (c) => {
  if (!canUseTickets(c.get("user"))) return c.json({ error: "Forbidden" }, 403);
  const kind = KINDS.find((k) => k === c.req.query("kind")) ?? "all";
  return c.json(await lookup(c.env.DB, c.req.query("q") ?? "", kind));
});
