import { MAX_EVENTS_PER_REQUEST, parseDeviceEvent, type DeviceEvent } from "../../lib/deviceAlerts";
import { deviceMonitorView, ingestDeviceEvents } from "../../lib/deviceMonitor";
import { canConfirmFault } from "../../lib/ticketAccess";
import { createApp } from "./_shared";

// Device status from the charger backend (machine to machine, shared token),
// and the read-only Device monitoring view for after-sales.
//
// POST /api/devices/status   header X-Device-Token: <DEVICE_INGEST_SECRET>
// body: one event, an array of events, or { "events": [...] }; each event:
//   { "serialNumber": "CHG-0901-0001", "status": "ONLINE" | "OFFLINE" | "FAULT",
//     "faultCode": "E12", "faultText": "RCD tripped", "occurredAt": "2026-10-20T08:00:00Z" }
// reply: { accepted, rejected: [{ index, error }], alerts }

export const deviceRoutes = createApp();

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

deviceRoutes.post("/devices/status", async (c) => {
  const secret = c.env.DEVICE_INGEST_SECRET;
  if (!secret || !sameSecret(c.req.header("x-device-token") ?? "", secret)) return c.json({ error: "Forbidden" }, 401);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Body must be JSON." }, 400);
  }
  const raw = Array.isArray(body) ? body : body && typeof body === "object" && Array.isArray((body as any).events) ? (body as any).events : [body];
  if (raw.length > MAX_EVENTS_PER_REQUEST) return c.json({ error: `At most ${MAX_EVENTS_PER_REQUEST} events per request.` }, 400);
  const now = new Date();
  const events: DeviceEvent[] = [];
  const rejected: { index: number; error: string }[] = [];
  raw.forEach((item: unknown, index: number) => {
    const parsed = parseDeviceEvent(item, now);
    if (parsed.ok) events.push(parsed.event);
    else rejected.push({ index, error: parsed.error });
  });
  const { alerts } = await ingestDeviceEvents(c.env, events, now);
  return c.json({ accepted: events.length, rejected, alerts });
});

deviceRoutes.get("/devices/monitor", async (c) => {
  if (!canConfirmFault(c.get("user"))) return c.json({ error: "Forbidden" }, 403);
  return c.json(await deviceMonitorView(c.env.DB));
});
