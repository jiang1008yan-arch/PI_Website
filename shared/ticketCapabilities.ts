// Single source of the ticket rules, shared across both bundles, like
// piCapabilities: what each role may do with tickets, which status a ticket may
// move to, and what must be settled before it is resolved. Pure — no DOM, no
// Workers, no env. The server ([functions/lib/ticketAccess.ts]) adds ownership
// (sales read only their own tickets) and enforces these; the client and the
// Feishu ticket card read them for what they offer.
//
// Types are string-literal unions, structurally identical to the ones declared
// in each bundle, so callers pass their own typed values.

export type Role = "ADMIN" | "SALES" | "SERVICE" | "COMMERCE" | "PRESALES";
export type TicketStatus = "NEW" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
export type TicketType = "FAULT" | "PRODUCT_REQUEST" | "OTHER";

export type TicketCapabilities = {
  // Sees the ticket pages at all.
  use: boolean;
  // Sees only the tickets in their name (the rest see all of them).
  ownTicketsOnly: boolean;
  create: boolean;
  changeStatus: boolean;
  writeNote: boolean;
  // Sets each side of a ticket's assignment. The after-sales team also puts a
  // ticket in a salesperson's name, since sales only see their own.
  assignService: boolean;
  assignSales: boolean;
  // Confirms the product line and fault type.
  confirmFault: boolean;
  // Registers device SNs on approved PIs.
  registerSn: boolean;
  manageFaultTypes: boolean;
};

const NONE: TicketCapabilities = {
  use: false,
  ownTicketsOnly: false,
  create: false,
  changeStatus: false,
  writeNote: false,
  assignService: false,
  assignSales: false,
  confirmFault: false,
  registerSn: false,
  manageFaultTypes: false
};
const AFTER_SALES: TicketCapabilities = {
  use: true,
  ownTicketsOnly: false,
  create: true,
  changeStatus: true,
  writeNote: true,
  assignService: true,
  assignSales: true,
  confirmFault: true,
  registerSn: true,
  manageFaultTypes: true
};

// ADMIN and SERVICE work the tickets; SALES read the ones in their name;
// COMMERCE and PRESALES have no ticket access.
const BY_ROLE: Record<Role, TicketCapabilities> = {
  ADMIN: AFTER_SALES,
  SERVICE: AFTER_SALES,
  SALES: { ...NONE, use: true, ownTicketsOnly: true },
  COMMERCE: NONE,
  PRESALES: NONE
};

export function ticketCapabilities(role: Role | null | undefined): TicketCapabilities {
  return (role && BY_ROLE[role]) || NONE;
}

const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  NEW: ["IN_PROGRESS", "RESOLVED"], // fixed on the spot
  IN_PROGRESS: ["RESOLVED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"], // reopen allowed
  CLOSED: []
};

export const nextStatuses = (from: TicketStatus): TicketStatus[] => TRANSITIONS[from] ?? [];

export const isValidTransition = (from: TicketStatus, to: TicketStatus) => nextStatuses(from).includes(to);

// What stops a ticket from being resolved: statistics depend on every resolved
// ticket being classified, and a fault confirmed. null when nothing does.
export function resolveBlocker(ticket: { ticketType?: string | null; faultType?: string | null }): "type" | "fault" | null {
  if (!ticket.ticketType) return "type";
  if (ticket.ticketType === "FAULT" && !ticket.faultType) return "fault";
  return null;
}
