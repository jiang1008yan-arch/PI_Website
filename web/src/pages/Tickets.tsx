import { LifeBuoy } from "lucide-react";
import { PageHero, Section } from "../components/Form";
import { TicketListPanel } from "../tickets/TicketListPanel";
import { TicketStatsPanel } from "../tickets/TicketStatsPanel";

// Customers report through Feishu; tickets are created there or here by staff.
export function TicketsPage() {
  return (
    <div className="space-y-6">
      <PageHero eyebrow="After-sales" title="Ticket Center" Icon={LifeBuoy} />
      {/* Counts by status, always in view above the list. */}
      <TicketStatsPanel />
      <Section title="Tickets">
        <TicketListPanel />
      </Section>
    </div>
  );
}
