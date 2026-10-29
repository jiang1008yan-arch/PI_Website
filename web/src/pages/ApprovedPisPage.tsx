import { Archive } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { PageHero, Section } from "../components/Form";
import { ApprovedPiList } from "../pi/ApprovedPiList";

// All approved Chinese PIs — commerce's archive; the read-only lookup for after-sales and presales.
export function ApprovedPisPage() {
  const { user } = useAuth();
  const lookup = user?.role === "SERVICE" || user?.role === "PRESALES";
  return (
    <div className="space-y-6">
      <PageHero
        eyebrow={lookup ? (user?.role === "PRESALES" ? "Presales lookup" : "After-sales lookup") : "Approved archive"}
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
