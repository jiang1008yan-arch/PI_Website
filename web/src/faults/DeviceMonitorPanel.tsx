import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { EmptyState, Section } from "../components/Form";
import { formatDateTime } from "../tickets/ticketShared";

type Alert = {
  serialNumber: string;
  status: string;
  faultCode: string | null;
  faultText: string | null;
  alertKind: "FAULT" | "OFFLINE";
  alertOpenedAt: string;
  offlineSince: string | null;
  lastEventAt: string;
  alertTicketId: string | null;
  alertTicketNo: string | null;
  customerCompany: string | null;
  productionOrderNo: string | null;
};
type Event = { serialNumber: string; status: string; faultCode: string | null; faultText: string | null; occurredAt: string };

const STATUS_STYLE: Record<string, string> = {
  ONLINE: "bg-green-50 text-green-700",
  OFFLINE: "bg-amber-50 text-amber-700",
  FAULT: "bg-red-50 text-red-700"
};

// Device problems reported by the charger backend: what is alerting now (and
// whether a ticket was created for it), and the latest status events. Alerts
// themselves arrive in the after-sales Feishu group.
export function DeviceMonitorPanel() {
  const [data, setData] = useState<{ alerts: Alert[]; events: Event[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get("/devices/monitor")
      .then((res) => setData(res.data))
      .catch(() => setError("Could not load device status."));
  }, []);

  if (error) return <div className="text-sm text-red-700">{error}</div>;
  if (!data) return <div className="py-8 text-center text-sm text-[#63749b]">Loading…</div>;

  return (
    <div className="space-y-6">
      <Section title="Open alerts">
        {data.alerts.length === 0 ? (
          <EmptyState title="No open alerts" description="Faults, and devices offline for over 2 hours, appear here and in the after-sales Feishu group." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-[#e3ecff] text-left text-xs font-medium text-[#8595b6]">
                  <th className="py-2 pr-3">SN</th>
                  <th className="py-2 pr-3">Problem</th>
                  <th className="py-2 pr-3">Customer · order</th>
                  <th className="py-2 pr-3">Since</th>
                  <th className="py-2">Ticket</th>
                </tr>
              </thead>
              <tbody>
                {data.alerts.map((a) => (
                  <tr key={a.serialNumber} className="border-b border-[#eef3fd] align-top">
                    <td className="whitespace-nowrap py-2 pr-3 font-mono text-[#07183f]">{a.serialNumber}</td>
                    <td className="py-2 pr-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[a.alertKind]}`}>{a.alertKind === "FAULT" ? "Fault" : "Offline"}</span>
                      {a.alertKind === "FAULT" && (
                        <span className="ml-2 text-[#294477]">
                          {a.faultCode || "—"}
                          {a.faultText ? ` · ${a.faultText}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-[#294477]">
                      {a.customerCompany || <span className="text-[#8595b6]">Not registered on a PI</span>}
                      {a.productionOrderNo ? ` · ${a.productionOrderNo}` : ""}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-[#294477]">{formatDateTime(a.alertKind === "OFFLINE" ? a.offlineSince : a.alertOpenedAt)}</td>
                    <td className="whitespace-nowrap py-2">
                      {a.alertTicketId ? (
                        <Link className="text-primary underline" to={`/tickets/${a.alertTicketId}`}>{a.alertTicketNo}</Link>
                      ) : (
                        <span className="text-[#8595b6]">Not yet</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Latest events">
        {data.events.length === 0 ? (
          <EmptyState
            title="No device events yet"
            description="The charger backend sends status to POST /api/devices/status with the shared device token. See docs/feishu-setup.md."
          />
        ) : (
          <ul className="space-y-1 text-sm">
            {data.events.map((e, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="w-36 shrink-0 text-xs text-[#8595b6]">{formatDateTime(e.occurredAt)}</span>
                <span className="font-mono text-[#07183f]">{e.serialNumber}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[e.status] ?? ""}`}>{e.status}</span>
                {e.faultCode && <span className="text-[#294477]">{e.faultCode}{e.faultText ? ` · ${e.faultText}` : ""}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
