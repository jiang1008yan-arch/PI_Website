import { useEffect, useState } from "react";
import { api } from "../api/client";
import { EmptyState } from "../components/Form";
import type { TicketStats, TicketStatus } from "../types";
import { STATUS_BADGE, STATUS_LABEL, STATUS_ORDER } from "./ticketShared";

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

export function TicketStatsPanel() {
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

  const statusCount = (s: TicketStatus) => stats.byStatus.find((r) => r.status === s)?.n ?? 0;
  const productRows = stats.byProduct.map((r) => ({ label: r.name, n: r.n }));
  const problemRows = stats.problemType
    ? Object.entries(stats.problemType.counts).map(([label, n]) => ({ label, n }))
    : [];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {STATUS_ORDER.map((s) => (
          <div key={s} className="rounded-lg border border-[#e8eef9] bg-white p-4 shadow-sm">
            <div className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[s]}`}>
              {STATUS_LABEL[s]}
            </div>
            <div className="mt-3 text-3xl font-semibold text-[#07183f]">{statusCount(s)}</div>
          </div>
        ))}
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#8595b6]">
          {stats.problemType ? `By ${stats.problemType.label}` : "By problem type"}
        </h3>
        {stats.problemType ? (
          <Bars rows={problemRows} />
        ) : (
          <EmptyState title="No problem-type question" description="Add a dropdown question to the ticket questionnaire to chart problem types." />
        )}
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#8595b6]">By product</h3>
        <Bars rows={productRows} />
      </div>
    </div>
  );
}
