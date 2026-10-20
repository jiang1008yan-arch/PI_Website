import { useState } from "react";
import { Activity } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { PageHero, Section } from "../components/Form";
import { DeviceMonitorPanel } from "../faults/DeviceMonitorPanel";
import { FaultSettings } from "../faults/FaultSettings";
import { FaultStatsPanel } from "../faults/FaultStatsPanel";

// Fault analytics: which products keep showing the same fault, and the fault
// type list and repeat-fault alert settings behind it. Further fault tooling
// (e.g. checks against the charger backend) gets its own tab here.

type Tab = "stats" | "devices" | "settings";

export function FaultAnalyticsPage() {
  const { user } = useAuth();
  const canConfigure = user?.role === "ADMIN" || user?.role === "SERVICE";
  const tabs: { key: Tab; label: string }[] = [
    { key: "stats", label: "Statistics" },
    ...(canConfigure
      ? [
          { key: "devices" as Tab, label: "Device monitoring" },
          { key: "settings" as Tab, label: "Fault types & alerts" }
        ]
      : [])
  ];
  const [tab, setTab] = useState<Tab>("stats");

  return (
    <div className="space-y-6">
      <PageHero eyebrow="After-sales" title="Fault Analytics" Icon={Activity} />
      {tabs.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button key={t.key} type="button" className={tab === t.key ? "btn-primary" : "btn-secondary"} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      {tab === "stats" && (
        <Section title="Statistics">
          <FaultStatsPanel />
        </Section>
      )}
      {tab === "devices" && canConfigure && <DeviceMonitorPanel />}
      {tab === "settings" && canConfigure && <FaultSettings />}
    </div>
  );
}
