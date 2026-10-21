import { all } from "../../lib/db";
import { lookup, type LookupKind } from "../../lib/lookup";
import { canCreateTicket } from "../../lib/ticketAccess";
import { createApp } from "./_shared";

// Type-ahead for production order numbers, customer names and device SNs
// (functions/lib/lookup.ts). For the people who create and edit tickets
// (ADMIN, SERVICE); sales only read their own tickets.

export const lookupRoutes = createApp();

const KINDS: LookupKind[] = ["all", "order", "customer", "sn"];

// The SNs registered on an approved Chinese PI — what a ticket's SN is picked from.
lookupRoutes.get("/lookup/pi/:piId/devices", async (c) => {
  if (!canCreateTicket(c.get("user"))) return c.json({ error: "Forbidden" }, 403);
  const rows = await all<{ serialNumber: string }>(
    c.env.DB,
    `SELECT d.serialNumber FROM devices d JOIN pi ON pi.id = d.piId
     WHERE d.piId = ? AND pi.language = 'ZH' AND (pi.status = 'APPROVED' OR pi.revisionInProgress = 1)
     ORDER BY d.serialNumber`,
    c.req.param("piId")
  );
  return c.json(rows.map((r) => r.serialNumber));
});

lookupRoutes.get("/lookup", async (c) => {
  if (!canCreateTicket(c.get("user"))) return c.json({ error: "Forbidden" }, 403);
  const kind = KINDS.find((k) => k === c.req.query("kind")) ?? "all";
  return c.json(await lookup(c.env.DB, c.req.query("q") ?? "", kind));
});
