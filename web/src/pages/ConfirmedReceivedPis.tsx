import { ShieldCheck } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { PageHero, Section } from "../components/Form";
import { ApprovedPiList } from "../pi/ApprovedPiList";
import { markAllSeen } from "../pi/notifications";

// A salesperson's approved Chinese PIs (created or received), after commerce approval.
export function ConfirmedReceivedPisPage() {
  const { user } = useAuth();
  return (
    <div className="space-y-6">
      <PageHero eyebrow="Approved archive" title="Confirmed Received PIs" Icon={ShieldCheck} />
      <Section title="Approved Chinese PIs">
        <ApprovedPiList
          scope="mine"
          // Opening this page counts as seeing these PIs — clear the home badge.
          onLoaded={(items) => markAllSeen("confirmedReceived", user?.id, items.map((pi) => pi.id))}
        />
      </Section>
    </div>
  );
}
