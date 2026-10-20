import { useState } from "react";
import { LifeBuoy } from "lucide-react";
import { PageHero, Section } from "../components/Form";
import { TicketListPanel } from "../tickets/TicketListPanel";
import { TicketLinksPanel } from "../tickets/TicketLinksPanel";
import { TicketStatsPanel } from "../tickets/TicketStatsPanel";

type Tab = "list" | "links";

const TABS: { key: Tab; label: string }[] = [
  { key: "list", label: "Tickets" },
  { key: "links", label: "My links" }
];

export function TicketsPage() {
  const [tab, setTab] = useState<Tab>("list");

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="After-sales"
        title="Ticket Center"
        Icon={LifeBuoy}
      />
      {/* Counts by status, always in view above the list. */}
      <TicketStatsPanel />
      <Section
        title={TABS.find((t) => t.key === tab)?.label ?? "Tickets"}
        action={
          <div className="flex flex-wrap gap-2">
            {TABS.map((t) => (
              <button key={t.key} className={tab === t.key ? "btn-primary" : "btn-secondary"} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
        }
      >
        {tab === "list" && <TicketListPanel />}
        {tab === "links" && <TicketLinksPanel />}
      </Section>
    </div>
  );
}
