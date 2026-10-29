import { describe, expect, it } from "vitest";
import { applyDeviceEvent, isOfflineAlertDue, parseDeviceEvent, type DeviceEvent, type DeviceRow } from "./deviceAlerts";

const now = new Date("2026-10-20T10:00:00Z");
const ev = (status: DeviceEvent["status"], occurredAt: string, faultCode: string | null = null): DeviceEvent => ({
  serialNumber: "CHG-1",
  status,
  faultCode,
  faultText: null,
  occurredAt
});

describe("parsing pushed device events", () => {
  it("normalizes SN and status, and defaults the time to now", () => {
    expect(parseDeviceEvent({ serialNumber: " chg-0001 ", status: "fault", faultCode: 12 }, now)).toEqual({
      ok: true,
      event: { serialNumber: "CHG-0001", status: "FAULT", faultCode: "12", faultText: null, occurredAt: "2026-10-20 10:00:00" }
    });
    expect(parseDeviceEvent({ serialNumber: "CHG-0001", status: "ONLINE", occurredAt: "2026-10-20T08:30:00+08:00" }, now)).toMatchObject({
      event: { occurredAt: "2026-10-20 00:30:00" }
    });
  });

  it("rejects bad input and never accepts future times", () => {
    expect(parseDeviceEvent({ status: "ONLINE" }, now)).toMatchObject({ ok: false });
    expect(parseDeviceEvent({ serialNumber: "CHG-1", status: "BROKEN" }, now)).toMatchObject({ ok: false });
    expect(parseDeviceEvent({ serialNumber: "CHG-1", status: "ONLINE", occurredAt: "yesterday" }, now)).toMatchObject({ ok: false });
    expect(parseDeviceEvent({ serialNumber: "CHG-1", status: "ONLINE", occurredAt: "2030-01-01T00:00:00Z" }, now)).toMatchObject({
      event: { occurredAt: "2026-10-20 10:00:00" }
    });
    expect(parseDeviceEvent("nope", now)).toMatchObject({ ok: false });
  });
});

describe("device alert rules", () => {
  it("a fault alerts at once, only once while open, and recovery closes it", () => {
    const first = applyDeviceEvent(null, ev("FAULT", "2026-10-20 09:00:00", "E12"))!;
    expect(first.open).toBe("FAULT");
    expect(first.next).toMatchObject({ status: "FAULT", faultCode: "E12", alertKind: "FAULT" });
    const again = applyDeviceEvent(first.next, ev("FAULT", "2026-10-20 09:05:00", "E13"))!;
    expect(again.open).toBeNull();
    expect(again.next).toMatchObject({ faultCode: "E13", alertKind: "FAULT" });
    const back = applyDeviceEvent(again.next, ev("ONLINE", "2026-10-20 09:30:00"))!;
    expect(back).toMatchObject({ open: null, closed: true, next: { status: "ONLINE", alertKind: null, faultCode: null } });
  });

  it("offline keeps the first time it went offline and alerts only after two hours", () => {
    const off = applyDeviceEvent(null, ev("OFFLINE", "2026-10-20 07:00:00"))!;
    expect(off.open).toBeNull();
    const stillOff = applyDeviceEvent(off.next, ev("OFFLINE", "2026-10-20 08:00:00"))!;
    expect(stillOff.next.offlineSince).toBe("2026-10-20 07:00:00");
    expect(isOfflineAlertDue(stillOff.next, new Date("2026-10-20T08:59:00Z"))).toBe(false);
    expect(isOfflineAlertDue(stillOff.next, new Date("2026-10-20T09:00:00Z"))).toBe(true);
    expect(isOfflineAlertDue({ ...stillOff.next, alertKind: "OFFLINE" }, now)).toBe(false);
  });

  it("ignores events older than what is already known", () => {
    const state = applyDeviceEvent(null, ev("ONLINE", "2026-10-20 09:00:00"))!.next as DeviceRow;
    expect(applyDeviceEvent(state, ev("FAULT", "2026-10-20 08:00:00", "E1"))).toBeNull();
  });
});
