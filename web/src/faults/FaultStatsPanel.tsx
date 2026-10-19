import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { EmptyState } from "../components/Form";
import type { FaultMatrix, Ticket, TicketStats } from "../types";

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

// Fault statistics: confirmed faults by product (the basis for repeat-fault
// alerts), plus what customers reported and tickets per product for reference.
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
  const problemRows = stats.problemType ? Object.entries(stats.problemType.counts).map(([label, n]) => ({ label, n })) : [];

  return (
    <div className="space-y-8">
      <div>
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[#8595b6]">Confirmed faults by product</h3>
        <p className="mb-3 text-xs text-[#8595b6]">Counts only fault types confirmed by after-sales. Click a number to see the models and tickets behind it.</p>
        <FaultMatrixTable matrix={stats.faultMatrix} />
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#8595b6]">
          {stats.problemType ? `Customer-reported: ${stats.problemType.label}` : "Customer-reported problem type"}
        </h3>
        {stats.problemType ? (
          <Bars rows={problemRows} />
        ) : (
          <EmptyState title="No problem-type question" description="An admin can add a dropdown question to the ticket questionnaire to chart what customers report." />
        )}
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#8595b6]">Tickets by product</h3>
        <Bars rows={productRows} />
      </div>
    </div>
  );
}

type Cell = { productId: string | null; productName: string; faultType: string };

// Product × confirmed fault type. Darker cells mean more tickets; a cell opens
// the concrete models and tickets behind the count.
function FaultMatrixTable({ matrix }: { matrix: FaultMatrix | undefined }) {
  const [cell, setCell] = useState<Cell | null>(null);
  const [models, setModels] = useState<{ model: string; n: number }[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);

  useEffect(() => {
    if (!cell) return;
    const params = { productId: cell.productId ?? "", faultType: cell.faultType };
    void api.get("/tickets/fault-breakdown", { params }).then((res) => setModels(res.data.byModel));
    void api.get("/tickets", { params }).then((res) => setTickets(res.data));
  }, [cell]);

  if (!matrix || matrix.products.length === 0) {
    return <EmptyState title="No confirmed faults yet" description="Confirm a fault type on a ticket to start the statistics." />;
  }
  const max = Math.max(1, ...matrix.products.flatMap((p) => Object.values(p.byFault)));

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              <th className="text-left text-xs font-medium text-[#8595b6]">Product</th>
              {matrix.faultTypes.map((f) => <th key={f} className="px-2 text-center text-xs font-medium text-[#294477]">{f}</th>)}
              <th className="px-2 text-center text-xs font-medium text-[#8595b6]">Total</th>
            </tr>
          </thead>
          <tbody>
            {matrix.products.map((p) => (
              <tr key={p.productId ?? "none"}>
                <td className="whitespace-nowrap pr-3 font-medium text-[#07183f]">{p.productName}</td>
                {matrix.faultTypes.map((f) => {
                  const n = p.byFault[f] ?? 0;
                  const active = cell?.productId === p.productId && cell?.faultType === f;
                  return (
                    <td key={f} className="text-center">
                      {n ? (
                        <button
                          type="button"
                          className={`w-full rounded-md px-2 py-1 font-semibold ${active ? "ring-2 ring-primary" : ""}`}
                          style={{ backgroundColor: `rgba(47, 107, 216, ${0.12 + 0.6 * (n / max)})`, color: n / max > 0.6 ? "white" : "#07183f" }}
                          onClick={() => setCell({ productId: p.productId, productName: p.productName, faultType: f })}
                        >
                          {n}
                        </button>
                      ) : (
                        <span className="text-[#c4cee4]">·</span>
                      )}
                    </td>
                  );
                })}
                <td className="text-center font-semibold text-[#294477]">{p.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cell && (
        <div className="rounded-lg border border-[#e3ecff] bg-[#f8fbff] p-4 text-sm">
          <div className="mb-2 font-semibold text-[#07183f]">{cell.productName} · {cell.faultType}</div>
          <div className="mb-3 flex flex-wrap gap-2">
            {models.map((m) => (
              <span key={m.model} className="rounded-full bg-white px-3 py-1 text-xs text-[#294477] ring-1 ring-[#dbe6fb]">{m.model}: {m.n}</span>
            ))}
          </div>
          <ul className="space-y-1">
            {tickets.map((t) => (
              <li key={t.id}>
                <Link className="text-primary underline" to={`/tickets/${t.id}`}>{t.ticketNo}</Link> · {t.customerCompany || "—"}
                {t.productModel ? ` · ${t.productModel}` : ""} · {t.createdAt?.slice(0, 10)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
