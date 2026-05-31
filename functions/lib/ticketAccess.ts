import type { AppUser } from "./types";

export type TicketStatus = "NEW" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";

// 需求2 permission model:
//   ADMIN    — full (view + status + notes + assign + generate links + config).
//   SERVICE  — view all, change status, write notes, self-assign service side, generate links.
//   SALES    — view all (read-only), generate links, self-assign sales side. No status/notes.
export const canChangeStatus = (user: AppUser) => user.role === "ADMIN" || user.role === "SERVICE";
export const canWriteNote = (user: AppUser) => user.role === "ADMIN" || user.role === "SERVICE";
export const canGenerateLink = (user: AppUser) =>
  user.role === "ADMIN" || user.role === "SERVICE" || user.role === "SALES";

const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  NEW: ["IN_PROGRESS"],
  IN_PROGRESS: ["RESOLVED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"], // reopen allowed
  CLOSED: []
};

export const isValidTransition = (from: TicketStatus, to: TicketStatus) =>
  TRANSITIONS[from]?.includes(to) ?? false;
