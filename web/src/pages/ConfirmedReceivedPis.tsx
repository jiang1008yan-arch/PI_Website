import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Section } from "../components/Form";
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
    <Section title="Confirmed Received PIs">
      {pis.length === 0 ? (
        <p className="text-sm text-slate-500">No approved Chinese PIs yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {pis.map((pi) => (
            <Link key={pi.id} to={`/pi/zh?piId=${pi.id}`} className="btn-secondary text-left">
              {piDisplayName(pi, "ZH")}
              <br />
              <span className="text-xs text-slate-500">{pi.customerCompany} - {pi.status}</span>
            </Link>
          ))}
        </div>
      )}
    </Section>
  );
}
