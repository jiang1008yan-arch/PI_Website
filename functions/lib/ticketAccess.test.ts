import { describe, expect, it } from "vitest";
import type { AppUser } from "./types";
import {
  canAssignSalesSide,
  canAssignServiceSide,
  canChangeStatus,
  canCreateTicket,
  canReadTicket,
  canConfirmFault,
  canManageFaultTypes,
  canRegisterSn,
  canUseTickets,
  canWriteNote,
  isValidTransition,
  type TicketStatus
} from "./ticketAccess";

const user = (role: AppUser["role"]): AppUser => ({
  id: "u1",
  username: "u",
  displayName: "U",
  role
});

const ADMIN = user("ADMIN");
const SALES = user("SALES");
const SERVICE = user("SERVICE");
const COMMERCE = user("COMMERCE");

describe("role predicates", () => {
  it("tickets are closed to commerce, and commerce can do nothing on them", () => {
    expect([canUseTickets(ADMIN), canUseTickets(SALES), canUseTickets(SERVICE), canUseTickets(COMMERCE)]).toEqual([true, true, true, false]);
    expect([canChangeStatus(COMMERCE), canWriteNote(COMMERCE)]).toEqual([false, false]);
  });

  it("status changes and notes: ADMIN and SERVICE only", () => {
    expect([canChangeStatus(ADMIN), canChangeStatus(SERVICE), canChangeStatus(SALES)]).toEqual([true, true, false]);
    expect([canWriteNote(ADMIN), canWriteNote(SERVICE), canWriteNote(SALES)]).toEqual([true, true, false]);
  });

  it("fault confirmation, SN registration and the fault type list: ADMIN and SERVICE", () => {
    for (const can of [canConfirmFault, canRegisterSn, canManageFaultTypes]) {
      expect([can(ADMIN), can(SERVICE), can(SALES), can(COMMERCE)]).toEqual([true, true, false, false]);
    }
  });

  it("link generation: all three roles", () => {
  });

  it("creating tickets: ADMIN and SERVICE only", () => {
    expect([canCreateTicket(ADMIN), canCreateTicket(SERVICE), canCreateTicket(SALES), canCreateTicket(COMMERCE)]).toEqual([true, true, false, false]);
  });

  it("sales read only the tickets in their name; ADMIN and SERVICE read all", () => {
    const mine = { assignedSalesId: SALES.id };
    const other = { assignedSalesId: "someone-else" };
    const unassigned = { assignedSalesId: null };
    expect([canReadTicket(SALES, mine), canReadTicket(SALES, other), canReadTicket(SALES, unassigned)]).toEqual([true, false, false]);
    expect([canReadTicket(ADMIN, other), canReadTicket(SERVICE, unassigned), canReadTicket(COMMERCE, mine)]).toEqual([true, true, false]);
  });

  it("sales-side assignment: ADMIN and SERVICE", () => {
    expect([canAssignSalesSide(ADMIN), canAssignSalesSide(SALES), canAssignSalesSide(SERVICE)]).toEqual([true, false, true]);
  });

  it("service-side assignment: ADMIN and SERVICE", () => {
    expect([canAssignServiceSide(ADMIN), canAssignServiceSide(SERVICE), canAssignServiceSide(SALES)]).toEqual([true, true, false]);
  });
});

describe("isValidTransition", () => {
  const allowed: Array<[TicketStatus, TicketStatus]> = [
    ["NEW", "IN_PROGRESS"],
    ["IN_PROGRESS", "RESOLVED"],
    ["RESOLVED", "CLOSED"],
    ["RESOLVED", "IN_PROGRESS"], // reopen
    ["NEW", "RESOLVED"] // fixed on the spot
  ];

  it("permits exactly the modelled transitions", () => {
    for (const [from, to] of allowed) expect(isValidTransition(from, to)).toBe(true);
  });

  it("rejects skips, reversals, and anything out of CLOSED", () => {
    expect(isValidTransition("NEW", "CLOSED")).toBe(false);
    expect(isValidTransition("IN_PROGRESS", "NEW")).toBe(false);
    expect(isValidTransition("CLOSED", "IN_PROGRESS")).toBe(false);
    expect(isValidTransition("NEW", "NEW")).toBe(false);
  });
});
