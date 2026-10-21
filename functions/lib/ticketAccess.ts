import type { AppUser } from "./types";

export type TicketStatus = "NEW" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";

// 需求2 permission model:
//   ADMIN    — full (view + status + notes + assign + generate links + config).
//   SERVICE  — view all, change status, write notes, self-assign service side, generate links.
//   SALES    — read-only, and only the tickets where they are the sales owner.
//              Cannot create tickets (on the website or from Feishu).
//   COMMERCE, PRESALES — no access to tickets at all.
export const canUseTickets = (user: AppUser) => user.role !== "COMMERCE" && user.role !== "PRESALES";
export const canCreateTicket = (user: AppUser) => user.role === "ADMIN" || user.role === "SERVICE";
// SALES are limited to their own tickets; everyone else with ticket access sees all.
export const seesOnlyOwnTickets = (user: AppUser) => user.role === "SALES";
export const canReadTicket = (user: AppUser, ticket: { assignedSalesId: string | null }) =>
  canUseTickets(user) && (!seesOnlyOwnTickets(user) || ticket.assignedSalesId === user.id);
// After-sales confirm a ticket's product line and fault type, register device
// SNs on approved PIs, and maintain the fault type list. The repeat-fault
// thresholds are an ADMIN setting.
export const canConfirmFault = (user: AppUser) => user.role === "ADMIN" || user.role === "SERVICE";
export const canRegisterSn = (user: AppUser) => user.role === "ADMIN" || user.role === "SERVICE";
export const canManageFaultTypes = (user: AppUser) => user.role === "ADMIN" || user.role === "SERVICE";
export const canChangeStatus = (user: AppUser) => user.role === "ADMIN" || user.role === "SERVICE";
export const canWriteNote = (user: AppUser) => user.role === "ADMIN" || user.role === "SERVICE";
// Who may set each side of a ticket's assignment: ADMIN both; SERVICE the
// service side and the sales owner (sales only see their own tickets, so the
// after-sales team puts a ticket in a salesperson's name).
export const canAssignSalesSide = (user: AppUser) => user.role === "ADMIN" || user.role === "SERVICE";
export const canAssignServiceSide = (user: AppUser) => user.role === "ADMIN" || user.role === "SERVICE";

const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  NEW: ["IN_PROGRESS"],
  IN_PROGRESS: ["RESOLVED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"], // reopen allowed
  CLOSED: []
};

export const isValidTransition = (from: TicketStatus, to: TicketStatus) =>
  TRANSITIONS[from]?.includes(to) ?? false;
