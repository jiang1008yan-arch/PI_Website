import { useEffect, useState } from "react";
import { BadgeCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState, PageHero, Section } from "../components/Form";
import { piDisplayName, revisionLabel } from "../pi/labels";
import { markAllSeen } from "../pi/notifications";
import type { Pi } from "../types";

// Shared queue of ZH PIs that passed presales confirmation and await commerce
// approval. Any commerce user may take any of them; ADMIN can watch the queue.
export function CommerceQueuePage() {
  const { user } = useAuth();
  const [queue, setQueue] = useState<Pi[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void api.get("/pi/commerce-queue").then((r) => {
      setQueue(r.data);
      setLoaded(true);
      // Opening the queue counts as seeing these PIs — clear the home badge.
      markAllSeen("pendingCommerce", user?.id, (r.data as Pi[]).map((p) => p.id));
    });
  }, [user?.id]);

  return (
    <div className="space-y-6">
      <PageHero eyebrow="Commerce" title="Pending Commerce Approval" Icon={BadgeCheck} />
      <Section title="Waiting for commerce approval">
        {loaded && queue.length === 0 ? (
          <EmptyState title="Nothing waiting" description="PIs appear here after presales confirmation." />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {queue.map((p) => (
              <Link key={p.id} to={`/pi/view/${p.id}`} className="choice-card">
                <span className="font-medium">{piDisplayName(p, "ZH")}</span>
                {Boolean(p.revisionInProgress) && (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                    {revisionLabel((p.revisionNo ?? 1) + 1)}
                  </span>
                )}
                <br />
                <span className="text-xs text-slate-500">
                  {p.customerCompany}
                  {p.productionOrderNo ? ` · ${p.productionOrderNo}` : ""} · from {p.createdByName}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
