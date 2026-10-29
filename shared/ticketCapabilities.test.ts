import { describe, expect, it } from "vitest";
import { isValidTransition, nextStatuses, resolveBlocker, ticketCapabilities, type Role, type TicketStatus } from "./ticketCapabilities";

describe("ticketCapabilities", () => {
  // The whole matrix, written out: a changed cell is a changed rule.
  const matrix: Record<Role, Record<string, boolean>> = {
    ADMIN: { use: true, ownTicketsOnly: false, create: true, changeStatus: true, writeNote: true, assignService: true, assignSales: true, confirmFault: true, registerSn: true, manageFaultTypes: true },
    SERVICE: { use: true, ownTicketsOnly: false, create: true, changeStatus: true, writeNote: true, assignService: true, assignSales: true, confirmFault: true, registerSn: true, manageFaultTypes: true },
    SALES: { use: true, ownTicketsOnly: true, create: false, changeStatus: false, writeNote: false, assignService: false, assignSales: false, confirmFault: false, registerSn: false, manageFaultTypes: false },
    COMMERCE: { use: false, ownTicketsOnly: false, create: false, changeStatus: false, writeNote: false, assignService: false, assignSales: false, confirmFault: false, registerSn: false, manageFaultTypes: false },
    PRESALES: { use: false, ownTicketsOnly: false, create: false, changeStatus: false, writeNote: false, assignService: false, assignSales: false, confirmFault: false, registerSn: false, manageFaultTypes: false }
  };

  for (const [role, expected] of Object.entries(matrix)) {
    it(`${role}`, () => expect(ticketCapabilities(role as Role)).toEqual(expected));
  }

  it("no user may do nothing", () => {
    expect(Object.values(ticketCapabilities(null)).some(Boolean)).toBe(false);
    expect(Object.values(ticketCapabilities(undefined)).some(Boolean)).toBe(false);
  });
});

describe("status transitions", () => {
  it("move forward, allow fixing on the spot and reopening, and stop at CLOSED", () => {
    const all: TicketStatus[] = ["NEW", "IN_PROGRESS", "RESOLVED", "CLOSED"];
    expect(Object.fromEntries(all.map((s) => [s, nextStatuses(s)]))).toEqual({
      NEW: ["IN_PROGRESS", "RESOLVED"],
      IN_PROGRESS: ["RESOLVED"],
      RESOLVED: ["CLOSED", "IN_PROGRESS"],
      CLOSED: []
    });
    for (const from of all) for (const to of all) expect(isValidTransition(from, to)).toBe(nextStatuses(from).includes(to));
  });
});

describe("resolveBlocker", () => {
  it("asks for the type first, then a fault's fault type", () => {
    expect(resolveBlocker({ ticketType: null })).toBe("type");
    expect(resolveBlocker({ ticketType: "FAULT", faultType: null })).toBe("fault");
    expect(resolveBlocker({ ticketType: "FAULT", faultType: "Offline" })).toBeNull();
    expect(resolveBlocker({ ticketType: "PRODUCT_REQUEST" })).toBeNull();
    expect(resolveBlocker({ ticketType: "OTHER", faultType: null })).toBeNull();
  });
});
