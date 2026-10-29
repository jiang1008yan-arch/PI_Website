import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { EmptyState } from "../components/Form";
import type { FaultRanking, TicketStats } from "../types";

// A rotating palette so each bar reads as its own category at a glance.
const PALETTE = [
  { bar: "from-[#3b7be8] to-[#0b4aa5]", dot: "bg-[#3b7be8]" },
  { bar: "from-[#25b577] to-[#078754]", dot: "bg-[#25b577]" },
  { bar: "from-[#fb923c] to-[#d95b0b]", dot: "bg-[#fb923c]" },
  { bar: "from-[#8b5cf6] to-[#6330c8]", dot: "bg-[#8b5cf6]" },
  { bar: "from-[#20a6c5] to-[#147b91]", dot: "bg-[#20a6c5]" },
  { bar: "from-[#f6477d] to-[#c01655]", dot: "bg-[#f6477d]" },
  { bar: "from-[#f7b500] to-[#d18f00]", dot: "bg-[#f7b500]" },
  { bar: "from-[#21b2b0] to-[#0f7f80]", dot: "bg-[#21b2b0]" }
];

function Bars({ rows }: { rows: { label: string; n: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (rows.length === 0) return <EmptyState title="No data" description="Counts will appear once tickets are submitted." />;
  return (
    <div className="flex items-end gap-4 overflow-x-auto px-1 pb-1 pt-7">
      {rows.map((r, i) => {
        const color = PALETTE[i % PALETTE.length];
        const height = r.n === 0 ? 0 : Math.max((r.n / max) * 100, 6);
        return (
          <div key={r.label} className="flex min-w-[60px] flex-1 flex-col items-center gap-2">
            <div className="flex h-44 w-full items-end justify-center">
              <div
                className={`relative flex w-full max-w-[48px] justify-center rounded-t-lg bg-gradient-to-t ${color.bar} transition-[height] duration-500`}
                style={{ height: `${height}%` }}
                title={`${r.label}: ${r.n}`}
              >
                <span className="absolute -top-6 text-sm font-semibold text-[#07183f]">{r.n}</span>
              </div>
            </div>
            <span className="w-full truncate text-center text-xs text-[#294477]" title={r.label}>
              {r.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Fault statistics: confirmed faults by product and model (the basis for
// repeat-fault alerts), plus tickets per product for reference.
export function FaultStatsPanel() {
  const [stats, setStats] = useState<TicketStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/tickets/stats")
      .then((res) => setStats(res.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="py-8 text-center text-sm text-[#63749b]">Loading…</div>;
  if (!stats) return <EmptyState title="No statistics" description="Statistics are unavailable." />;

  const productRows = stats.byProduct.map((r) => ({ label: r.name, n: r.n }));

  return (
    <div className="space-y-8">
      <div>
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[#8595b6]">Confirmed faults by product and model</h3>
        <p className="mb-3 text-xs text-[#8595b6]">Counts only fault types confirmed by after-sales. Click a row to see its tickets.</p>
        <FaultRankingList />
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#8595b6]">Tickets by product</h3>
        <Bars rows={productRows} />
      </div>
    </div>
  );
}

const PERIODS = [
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last 12 months" },
  { value: "all", label: "All time" }
];

type RankingRow = FaultRanking["rows"][number];
const rowKey = (r: RankingRow) => `${r.productId}|${r.productModel}|${r.faultType}`;

// Confirmed faults ranked by product · model · fault type, filtered by period,
// fault type and a product/model search. A row opens its tickets.
function FaultRankingList() {
  const [period, setPeriod] = useState<string | null>(null);
  const [data, setData] = useState<FaultRanking | null>(null);
  const [loading, setLoading] = useState(true);
  const [faultType, setFaultType] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .get("/tickets/fault-ranking", { params: period ? { days: period } : {} })
      .then((res) => {
        setData(res.data);
        if (!period) setPeriod(String(res.data.days));
      })
      .finally(() => setLoading(false));
  }, [period]);

  const faultTypes = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.faultType))].sort(), [data]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.rows ?? []).filter(
      (r) => (!faultType || r.faultType === faultType) && (!q || `${r.productName} ${r.productModel ?? ""}`.toLowerCase().includes(q))
    );
  }, [data, faultType, search]);

  // The default period is the repeat window, which may not be one of the presets.
  const periods = period && !PERIODS.some((p) => p.value === period) ? [{ value: period, label: `Last ${period} days` }, ...PERIODS] : PERIODS;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <select aria-label="Period" value={period ?? ""} onChange={(e) => setPeriod(e.target.value)}>
          {periods.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <select aria-label="Fault type" value={faultType} onChange={(e) => setFaultType(e.target.value)}>
          <option value="">All fault types</option>
          {faultTypes.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <input aria-label="Search product or model" placeholder="Search product or model" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {loading && !data ? (
        <div className="py-8 text-center text-sm text-[#63749b]">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No confirmed faults"
          description={data?.rows.length ? "Nothing matches these filters." : "Confirm a fault type on a ticket to start the statistics."}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-[#e3ecff] text-left text-xs font-medium text-[#8595b6]">
                <th className="py-2 pr-3">Product</th>
                <th className="py-2 pr-3">Model</th>
                <th className="py-2 pr-3">Fault type</th>
                <th className="py-2 pr-3 text-right">Count</th>
                <th className="py-2">Latest</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = rowKey(r);
                const isOpen = open === key;
                return (
                  <Fragment key={key}>
                    <tr
                      className={`cursor-pointer border-b border-[#eef3fd] hover:bg-[#f8fbff] ${isOpen ? "bg-[#f8fbff]" : ""}`}
                      onClick={() => setOpen(isOpen ? null : key)}
                    >
                      <td className="whitespace-nowrap py-2 pr-3 font-medium text-[#07183f]">{r.productName}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-[#294477]">{r.productModel ?? <span className="text-[#8595b6]">Not recorded</span>}</td>
                      <td className="py-2 pr-3 text-[#294477]">
                        <span className="mr-2">{r.faultType}</span>
                        {r.isRepeat && data && (
                          <span
                            className="inline-block whitespace-nowrap rounded-full bg-[#fde8ee] px-2 py-0.5 text-xs font-semibold text-[#c01655]"
                            title={`${r.productName} has had "${r.faultType}" ${r.productTotal} times in the last ${data.windowDays} days (threshold ${data.threshold}), across all models.`}
                          >
                            Repeat · {r.productTotal}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right font-semibold text-[#07183f]">{r.n}</td>
                      <td className="whitespace-nowrap py-2 text-[#294477]">{r.lastAt.slice(0, 10)}</td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-[#eef3fd] bg-[#f8fbff]">
                        <td colSpan={5} className="px-3 pb-3 pt-1">
                          <ul className="space-y-1">
                            {r.tickets.map((t) => (
                              <li key={t.id}>
                                <Link className="text-primary underline" to={`/tickets/${t.id}`}>{t.ticketNo}</Link> · {t.customerCompany || "—"} · {t.createdAt.slice(0, 10)}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
