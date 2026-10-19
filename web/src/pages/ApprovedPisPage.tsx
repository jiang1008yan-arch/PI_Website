import { Archive } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { PageHero, Section } from "../components/Form";
import { ApprovedPiList } from "../pi/ApprovedPiList";

// All approved Chinese PIs — commerce's archive and after-sales' lookup.
export function ApprovedPisPage() {
  const { user } = useAuth();
  const lookup = user?.role === "SERVICE";
  return (
    <div className="space-y-6">
      <PageHero
        eyebrow={lookup ? "After-sales lookup" : "Approved archive"}
        title={lookup ? "Approved PI Lookup" : "Approved PIs"}
        description={lookup ? "Find the approved Chinese PI behind a customer, production order or serial number." : undefined}
        Icon={Archive}
      />
      <Section title="Approved Chinese PIs">
        <ApprovedPiList />
      </Section>
    </div>
  );
}
