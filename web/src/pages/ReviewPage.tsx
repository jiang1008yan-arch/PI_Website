import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState, PageHero, Section } from "../components/Form";
import { markAllSeen } from "../pi/notifications";

export function ReviewPage() {
  const { user } = useAuth();
  const [queue, setQueue] = useState<any[]>([]);
  useEffect(() => {
    void api.get("/pi/review-queue").then((r) => {
      setQueue(r.data);
      // Opening the queue counts as seeing these PIs — clear the home badge.
      markAllSeen("pendingReviews", user?.id, (r.data as { id: string }[]).map((p) => p.id));
    });
  }, [user?.id]);

  return (
    <div className="space-y-6">
      <PageHero eyebrow="Review queue" title="Pending Reviews" Icon={Clock3} />
      <Section title="Pending Chinese PI Reviews">
        {queue.length === 0 ? (
          <EmptyState title="No pending reviews" description="When a Chinese PI is sent to you, it will appear here for approval or rejection." />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {queue.map((p) => (
              // Open the PI in the editable review flow (/pi/zh) so the approver
              // can edit the order and then Confirm or Reject it (需求3).
              <Link key={p.id} to={`/pi/zh?piId=${p.id}`} className="choice-card">
                {p.productionOrderNo || p.piNo}
                <br />
                <span className="text-xs text-slate-500">{p.customerCompany} - from {p.createdByName}</span>
              </Link>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
