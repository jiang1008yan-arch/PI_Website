import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Plus, Search } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { EmptyState } from "../components/Form";
import { useAuth } from "../auth/AuthContext";
import { markSeen } from "../pi/notifications";
import { api } from "../api/client";
import { useCachedList } from "../hooks/useCachedList";
import type { Ticket, TicketStatus, TicketType } from "../types";
import { STATUS_BADGE, STATUS_LABEL, STATUS_ORDER, TICKET_TYPE_LABEL, formatDateTime } from "./ticketShared";
import { ticketCapabilities } from "../../../shared/ticketCapabilities";

export function TicketListPanel() {
  const [status, setStatus] = useState<"" | TicketStatus>("");
  // ?q= pre-fills the search (links from "earlier tickets like this").
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [type, setType] = useState<"" | TicketType | "NONE">("");
  // Cached per status filter so re-entering the tab (or switching filters back)
  // paints instantly, then revalidates.
  const { data: tickets, loading } = useCachedList<Ticket>(
    `tickets:${status || "all"}`,
    () => api.get("/tickets", { params: status ? { status } : {} }).then((res) => res.data)
  );

  // Seeing the list counts as seeing its new tickets: clear the home badge.
  const { user } = useAuth();
  // Sales only read the tickets in their name; ADMIN and SERVICE create them.
  const canCreate = ticketCapabilities(user?.role).create;
  useEffect(() => {
    markSeen(["newTickets"], user?.id, tickets.filter((t) => t.status === "NEW").map((t) => t.id));
  }, [tickets, user?.id]);

  // Ticket type, then free-text search across ticket number, order, company,
  // product name, SN, fault type and summary.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tickets.filter(
      (t) =>
        (!type || (type === "NONE" ? !t.ticketType : t.ticketType === type)) &&
        (!q ||
          [t.ticketNo, t.orderNo, t.customerCompany, t.productNameEn, t.productNameZh, t.serialNumber, t.faultType, t.summary].some((v) =>
            (v ?? "").toLowerCase().includes(q)
          ))
    );
  }, [tickets, query, type]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button className={status === "" ? "btn-primary" : "btn-secondary"} onClick={() => setStatus("")}>
            All
          </button>
          {STATUS_ORDER.map((s) => (
            <button key={s} className={status === s ? "btn-primary" : "btn-secondary"} onClick={() => setStatus(s)}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <select aria-label="Ticket type" className="w-full sm:w-48" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="">All types</option>
            {(Object.keys(TICKET_TYPE_LABEL) as TicketType[]).map((t) => (
              <option key={t} value={t}>{TICKET_TYPE_LABEL[t]}</option>
            ))}
            <option value="NONE">Not classified</option>
          </select>
          <div className="relative w-full sm:w-72">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8595b6]" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ticket, production order, company, product"
              className="w-full rounded-lg border border-[#e0e8f7] bg-white py-2 pl-9 pr-3 text-sm text-[#07183f] outline-none transition placeholder:text-[#9aa8c6] focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
            />
          </div>
          {canCreate && (
            <Link
              to="/tickets/new"
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#eef3ff] px-4 py-2 text-sm font-semibold text-primary transition hover:bg-[#e0e9ff]"
            >
              <Plus size={16} />
              New ticket
            </Link>
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-[#63749b]">Loading…</div>
      ) : tickets.length === 0 ? (
        <EmptyState title="No tickets" description="Tickets submitted through your links will appear here." />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matches" description="Nothing matches these filters. Try a different type, ticket, order, company or product." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[#8595b6]">
              <th className="py-2">Ticket</th>
              <th>Company</th>
              <th>Production order</th>
              <th>Product</th>
              <th>Type</th>
              <th>Status</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.id} className="border-t">
                <td className="py-3 font-medium text-[#07183f]">{t.ticketNo}</td>
                <td>{t.customerCompany}</td>
                <td>{t.orderNo}</td>
                <td>{t.productNameEn ?? "—"}</td>
                <td className="text-[#294477]">{t.ticketType ? TICKET_TYPE_LABEL[t.ticketType] : <span className="text-[#8595b6]">—</span>}</td>
                <td>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[t.status]}`}>
                    {STATUS_LABEL[t.status]}
                  </span>
                </td>
                <td className="text-[#63749b]">{formatDateTime(t.createdAt)}</td>
                <td className="text-right">
                  <Link
                    to={`/tickets/${t.id}`}
                    title="Open ticket"
                    aria-label={`Open ticket ${t.ticketNo}`}
                    className="inline-grid h-9 w-9 place-items-center rounded-full border border-[#e0e8f7] bg-white text-[#294477] shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:text-primary hover:shadow-md"
                  >
                    <ArrowUpRight size={17} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
