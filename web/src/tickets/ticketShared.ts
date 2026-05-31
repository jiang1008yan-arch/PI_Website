import type { TicketStatus } from "../types";

export const STATUS_ORDER: TicketStatus[] = ["NEW", "IN_PROGRESS", "RESOLVED", "CLOSED"];

export const STATUS_LABEL: Record<TicketStatus, string> = {
  NEW: "New",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  CLOSED: "Closed"
};

export const STATUS_BADGE: Record<TicketStatus, string> = {
  NEW: "bg-blue-50 text-blue-700",
  IN_PROGRESS: "bg-amber-50 text-amber-700",
  RESOLVED: "bg-green-50 text-green-700",
  CLOSED: "bg-slate-100 text-slate-600"
};

// Mirrors functions/lib/ticketAccess.ts TRANSITIONS.
export const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  NEW: ["IN_PROGRESS"],
  IN_PROGRESS: ["RESOLVED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: []
};

export function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}
