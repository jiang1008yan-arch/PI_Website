import { useMemo, useState } from "react";
import { ArrowUpRight, Plus, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState } from "../components/Form";
import { api } from "../api/client";
import { useCachedList } from "../hooks/useCachedList";
import type { Ticket, TicketStatus } from "../types";
import { STATUS_BADGE, STATUS_LABEL, STATUS_ORDER, formatDateTime } from "./ticketShared";

export function TicketListPanel() {
  const [status, setStatus] = useState<"" | TicketStatus>("");
  const [query, setQuery] = useState("");
  // Cached per status filter so re-entering the tab (or switching filters back)
  // paints instantly, then revalidates.
  const { data: tickets, loading } = useCachedList<Ticket>(
    `tickets:${status || "all"}`,
    () => api.get("/tickets", { params: status ? { status } : {} }).then((res) => res.data)
  );

  // Free-text search across ticket number, order, company and product name.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tickets;
    return tickets.filter((t) =>
      [t.ticketNo, t.orderNo, t.customerCompany, t.productNameEn, t.productNameZh]
        .some((v) => (v ?? "").toLowerCase().includes(q))
    );
  }, [tickets, query]);

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
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative w-full sm:w-72">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8595b6]" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ticket, order, company, product"
              className="w-full rounded-lg border border-[#e0e8f7] bg-white py-2 pl-9 pr-3 text-sm text-[#07183f] outline-none transition placeholder:text-[#9aa8c6] focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
            />
          </div>
          <Link
            to="/tickets/new"
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#eef3ff] px-4 py-2 text-sm font-semibold text-primary transition hover:bg-[#e0e9ff]"
          >
            <Plus size={16} />
            New ticket
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-[#63749b]">Loading…</div>
      ) : tickets.length === 0 ? (
        <EmptyState title="No tickets" description="Tickets submitted through your links will appear here." />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matches" description={`Nothing matches “${query.trim()}”. Try a different ticket, order, company or product.`} />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[#8595b6]">
              <th className="py-2">Ticket</th>
              <th>Company</th>
              <th>Order</th>
              <th>Product</th>
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
