import { ticketCapabilities } from "../../shared/ticketCapabilities";
import type { AppUser } from "./types";

// Who may do what with tickets is the role table in shared/ticketCapabilities
// (ADMIN and SERVICE work the tickets; SALES read the ones in their name;
// COMMERCE and PRESALES have none). The server adds ownership here.
export type { TicketStatus } from "../../shared/ticketCapabilities";
export { isValidTransition } from "../../shared/ticketCapabilities";

const may = (user: AppUser) => ticketCapabilities(user.role);

export const canUseTickets = (user: AppUser) => may(user).use;
export const canCreateTicket = (user: AppUser) => may(user).create;
export const seesOnlyOwnTickets = (user: AppUser) => may(user).ownTicketsOnly;
export const canReadTicket = (user: AppUser, ticket: { assignedSalesId: string | null }) =>
  canUseTickets(user) && (!seesOnlyOwnTickets(user) || ticket.assignedSalesId === user.id);
export const canConfirmFault = (user: AppUser) => may(user).confirmFault;
export const canRegisterSn = (user: AppUser) => may(user).registerSn;
export const canManageFaultTypes = (user: AppUser) => may(user).manageFaultTypes;
export const canChangeStatus = (user: AppUser) => may(user).changeStatus;
export const canWriteNote = (user: AppUser) => may(user).writeNote;
export const canAssignSalesSide = (user: AppUser) => may(user).assignSales;
export const canAssignServiceSide = (user: AppUser) => may(user).assignService;
