import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { EmptyState } from "../components/Form";
import { piDisplayName, revisionLabel } from "./labels";
import type { Pi } from "../types";

// Searchable, paged list of approved Chinese PIs (newest commerce approval
// first). Used by commerce ("Approved PIs"), sales ("Confirmed Received PIs",
// scope "mine") and after-sales ("Approved PI Lookup"). Paging and search run
// on the server; every card opens the read-only detail page.

export function ApprovedPiList({
  scope = "all",
  onLoaded
}: {
  scope?: "all" | "mine";
  onLoaded?: (items: Pi[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Pi[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestNo = useRef(0);

  async function fetchPage(q: string, offset: number) {
    const ticket = ++requestNo.current;
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/pi/approved", { params: { q, offset, scope } });
      if (ticket !== requestNo.current) return; // a newer search superseded this one
      const page: Pi[] = res.data.items ?? [];
      setItems((prev) => {
        const next = offset === 0 ? page : [...prev, ...page];
        if (offset === 0) onLoaded?.(next);
        return next;
      });
      setHasMore(Boolean(res.data.hasMore));
    } catch (err: any) {
      if (ticket === requestNo.current) setError(err.response?.data?.error ?? err.message ?? "Could not load PIs.");
    } finally {
      if (ticket === requestNo.current) setLoading(false);
    }
  }

  // Debounce typing so each keystroke doesn't hit the server.
  useEffect(() => {
    const timer = window.setTimeout(() => void fetchPage(query.trim(), 0), query ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [query, scope]);

  return (
    <div className="space-y-4">
      <label className="relative block max-w-xl">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8595b6]" />
        <input
          className="w-full pl-9"
          placeholder="Search PI No., production order no., customer or SN"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {items.length === 0 && !loading ? (
        <EmptyState
          title={query ? "No matching approved PIs" : "No approved Chinese PIs yet"}
          description={query ? "Try a PI number, production order number, customer name or serial number." : "PIs appear here once commerce approves them."}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((pi) => (
            <Link key={pi.id} to={`/pi/view/${pi.id}`} className="choice-card">
              <span className="font-medium">{piDisplayName(pi, "ZH")}</span>
              <span className="ml-2 text-xs text-slate-400">{revisionLabel(pi.revisionNo)}</span>
              {Boolean(pi.revisionInProgress) && (
                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">Revision in progress</span>
              )}
              <br />
              <span className="text-xs text-slate-500">
                {pi.customerCompany}
                {pi.productionOrderNo ? ` · ${pi.productionOrderNo}` : ""}
                {pi.approvedAt ? ` · approved ${pi.approvedAt.slice(0, 10)}` : ""}
              </span>
            </Link>
          ))}
        </div>
      )}

      {loading && <div className="text-sm text-slate-500">Loading…</div>}
      {hasMore && !loading && (
        <button type="button" className="btn-secondary" onClick={() => void fetchPage(query.trim(), items.length)}>
          Load more
        </button>
      )}
    </div>
  );
}
