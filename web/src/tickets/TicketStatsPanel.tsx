import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { EmptyState } from "../components/Form";
import type { TicketStats, TicketStatus } from "../types";
import { STATUS_BADGE, STATUS_LABEL, STATUS_ORDER } from "./ticketShared";

// Ticket counts by status. Fault statistics live in Fault Analytics.
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

  return (
    <div className="space-y-4">
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
      <p className="text-sm text-[#63749b]">
        Repeat faults by product and fault type are in <Link className="text-primary underline" to="/fault-analytics">Fault Analytics</Link>.
      </p>
    </div>
  );
}
