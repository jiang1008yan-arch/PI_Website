import { describe, expect, it } from "vitest";
import type { AppUser } from "./types";
import {
  canAssignSalesSide,
  canAssignServiceSide,
  canChangeStatus,
  canGenerateLink,
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

describe("role predicates", () => {
  it("status changes and notes: ADMIN and SERVICE only", () => {
    expect([canChangeStatus(ADMIN), canChangeStatus(SERVICE), canChangeStatus(SALES)]).toEqual([true, true, false]);
    expect([canWriteNote(ADMIN), canWriteNote(SERVICE), canWriteNote(SALES)]).toEqual([true, true, false]);
  });

  it("link generation: all three roles", () => {
    expect([canGenerateLink(ADMIN), canGenerateLink(SERVICE), canGenerateLink(SALES)]).toEqual([true, true, true]);
  });

  it("sales-side assignment: ADMIN and SALES", () => {
    expect([canAssignSalesSide(ADMIN), canAssignSalesSide(SALES), canAssignSalesSide(SERVICE)]).toEqual([true, true, false]);
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
    ["RESOLVED", "IN_PROGRESS"] // reopen
  ];

  it("permits exactly the modelled transitions", () => {
    for (const [from, to] of allowed) expect(isValidTransition(from, to)).toBe(true);
  });

  it("rejects skips, reversals, and anything out of CLOSED", () => {
    expect(isValidTransition("NEW", "RESOLVED")).toBe(false);
    expect(isValidTransition("IN_PROGRESS", "NEW")).toBe(false);
    expect(isValidTransition("CLOSED", "IN_PROGRESS")).toBe(false);
    expect(isValidTransition("NEW", "NEW")).toBe(false);
  });
});
