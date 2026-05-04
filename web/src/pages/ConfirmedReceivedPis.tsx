import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState, PageHero, Section } from "../components/Form";
import { isUserApprovedChinesePi, piDisplayName } from "../pi/labels";
import type { Pi } from "../types";

export function ConfirmedReceivedPisPage() {
  const { user } = useAuth();
  const [pis, setPis] = useState<Pi[]>([]);

  useEffect(() => {
    async function loadConfirmedReceivedPis() {
      const res = await api.get("/pi");
      setPis(res.data.filter((pi: Pi) => isUserApprovedChinesePi(pi, user?.id)));
    }

    void loadConfirmedReceivedPis();
  }, [user?.id]);

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Approved archive"
        title="Confirmed Received PIs"
        description="Reopen approved received Chinese PIs whenever you need to verify details or download the final Excel file."
        Icon={ShieldCheck}
      />
      <Section title="Confirmed Received PIs">
        {pis.length === 0 ? (
          <EmptyState title="No approved Chinese PIs yet" description="Once you confirm a received PI, it will stay here for quick access." />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {pis.map((pi) => (
              <Link key={pi.id} to={`/pi/zh?piId=${pi.id}`} className="choice-card">
                {piDisplayName(pi, "ZH")}
                <br />
                <span className="text-xs text-slate-500">{pi.customerCompany} - {pi.status}</span>
              </Link>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
