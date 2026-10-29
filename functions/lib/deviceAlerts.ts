// Rules for device status pushed by the charger backend (pure; I/O in
// deviceMonitor.ts):
// - a FAULT opens an alert at once;
// - OFFLINE opens an alert once it has lasted OFFLINE_ALERT_HOURS (checked by
//   the scheduled job);
// - while an alert is open for an SN no second one is raised;
// - back ONLINE closes the alert.

import { parseSqlTime, sqlTime } from "./db";

export const DEVICE_STATUSES = ["ONLINE", "OFFLINE", "FAULT"] as const;
export type DeviceState = (typeof DEVICE_STATUSES)[number];
export const OFFLINE_ALERT_HOURS = 2;
export const MAX_EVENTS_PER_REQUEST = 500;

export type DeviceEvent = { serialNumber: string; status: DeviceState; faultCode: string | null; faultText: string | null; occurredAt: string };

export type DeviceRow = {
  serialNumber: string;
  status: DeviceState;
  faultCode: string | null;
  faultText: string | null;
  lastEventAt: string;
  offlineSince: string | null;
  alertKind: "FAULT" | "OFFLINE" | null;
  alertOpenedAt: string | null;
};

const text = (v: unknown, max: number) => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, max) : "") || null;

// Validates one pushed event; occurredAt accepts ISO 8601 (defaults to now).
export function parseDeviceEvent(raw: unknown, now: Date): { ok: true; event: DeviceEvent } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Each event must be an object." };
  const r = raw as Record<string, unknown>;
  const serialNumber = String(r.serialNumber ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._/-]{2,63}$/.test(serialNumber)) return { ok: false, error: "serialNumber is missing or invalid." };
  const status = DEVICE_STATUSES.find((s) => s === String(r.status ?? "").trim().toUpperCase());
  if (!status) return { ok: false, error: "status must be ONLINE, OFFLINE or FAULT." };
  let occurredAt = now;
  if (r.occurredAt !== undefined && r.occurredAt !== null && r.occurredAt !== "") {
    occurredAt = new Date(String(r.occurredAt));
    if (Number.isNaN(occurredAt.getTime())) return { ok: false, error: "occurredAt must be an ISO 8601 date-time." };
    if (occurredAt.getTime() > now.getTime() + 5 * 60 * 1000) occurredAt = now; // clock skew: never in the future
  }
  return {
    ok: true,
    event: { serialNumber, status, faultCode: text(r.faultCode, 64), faultText: text(r.faultText, 500), occurredAt: sqlTime(occurredAt) }
  };
}

// The new state after an event, and whether it opens or closes an alert.
export function applyDeviceEvent(prev: DeviceRow | null, ev: DeviceEvent): { next: DeviceRow; open: "FAULT" | null; closed: boolean } | null {
  // Older than what we already know: kept in the event log, state unchanged.
  if (prev && ev.occurredAt < prev.lastEventAt) return null;
  const base: DeviceRow = {
    serialNumber: ev.serialNumber,
    status: ev.status,
    faultCode: ev.status === "FAULT" ? ev.faultCode : null,
    faultText: ev.status === "FAULT" ? ev.faultText : null,
    lastEventAt: ev.occurredAt,
    offlineSince: null,
    alertKind: prev?.alertKind ?? null,
    alertOpenedAt: prev?.alertOpenedAt ?? null
  };
  if (ev.status === "ONLINE") {
    return { next: { ...base, alertKind: null, alertOpenedAt: null }, open: null, closed: Boolean(prev?.alertKind) };
  }
  if (ev.status === "OFFLINE") {
    return { next: { ...base, offlineSince: prev?.status === "OFFLINE" && prev.offlineSince ? prev.offlineSince : ev.occurredAt }, open: null, closed: false };
  }
  // FAULT
  if (prev?.alertKind) return { next: base, open: null, closed: false };
  return { next: { ...base, alertKind: "FAULT", alertOpenedAt: ev.occurredAt }, open: "FAULT", closed: false };
}

// Offline long enough, with no alert open yet.
export function isOfflineAlertDue(row: Pick<DeviceRow, "status" | "offlineSince" | "alertKind">, now: Date): boolean {
  return (
    row.status === "OFFLINE" &&
    !row.alertKind &&
    Boolean(row.offlineSince) &&
    now.getTime() - parseSqlTime(row.offlineSince!).getTime() >= OFFLINE_ALERT_HOURS * 60 * 60 * 1000
  );
}
