import { LifeBuoy } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { PageHero, Section } from "../components/Form";
import { TicketListPanel } from "../tickets/TicketListPanel";
import { TicketStatsPanel } from "../tickets/TicketStatsPanel";
import { ticketCapabilities } from "../../../shared/ticketCapabilities";

// Customers report through Feishu; tickets are created there or here by staff.
// Sales only follow the tickets in their name, so the page is theirs to read.
export function TicketsPage() {
  const { user } = useAuth();
  const own = ticketCapabilities(user?.role).ownTicketsOnly;
  return (
    <div className="space-y-6">
      <PageHero
        eyebrow={own ? "Sales" : "After-sales"}
        title={own ? "Your Customers' Tickets" : "Ticket Center"}
        description={own ? "Service tickets in your name, handled by after-sales. You get a Feishu message when they change." : undefined}
        Icon={LifeBuoy}
      />
      {/* Counts by status, always in view above the list. */}
      <TicketStatsPanel />
      <Section title="Tickets">
        <TicketListPanel />
      </Section>
    </div>
  );
}
