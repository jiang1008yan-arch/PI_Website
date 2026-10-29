import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { OptionSetModal } from "../pi/OptionSetModal";
import { SelectWithManage } from "../pi/SelectWithManage";
import type { RepeatInfo, Ticket } from "../types";
import { formatDateTime } from "./ticketShared";

// The confirmed fault type of a fault ticket (from the maintained list), and how
// often the same fault has hit the same product recently. Part of the ticket's
// classification, shown under its type.
export function TicketFault({
  ticket,
  repeat,
  canManage,
  onChanged
}: {
  ticket: Ticket;
  repeat: RepeatInfo | null;
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const [faultTypes, setFaultTypes] = useState<string[]>([]);
  const [fault, setFault] = useState(ticket.faultType ?? "");
  const [managing, setManaging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadFaultTypes = () => api.get("/options/faultType").then((res) => setFaultTypes(res.data.map((r: any) => r.value)));
  useEffect(() => {
    void loadFaultTypes();
  }, []);
  useEffect(() => setFault(ticket.faultType ?? ""), [ticket.id, ticket.faultType]);

  async function confirm() {
    setError("");
    setBusy(true);
    try {
      await api.patch(`/tickets/${ticket.id}/fault`, { faultType: fault });
      await onChanged();
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Could not confirm the fault type.");
    } finally {
      setBusy(false);
    }
  }
  async function saveFaultTypes(values: string[]) {
    await api.put("/options/faultType", { values });
    setManaging(false);
    await loadFaultTypes();
  }

  return (
    <div className="space-y-3 border-t pt-3">
      {canManage ? (
        <>
          <SelectWithManage label="Fault type" value={fault} options={faultTypes} disabled={busy} canManage onChange={setFault} onManage={() => setManaging(true)} />
          <button type="button" className="btn-secondary" disabled={busy || !fault || fault === ticket.faultType} onClick={confirm}>
            Confirm fault type
          </button>
        </>
      ) : (
        <div className="text-sm">
          <span className="text-xs uppercase tracking-wide text-[#8595b6]">Fault type</span>
          <div className="text-[#07183f]">{ticket.faultType || "Not confirmed yet"}</div>
        </div>
      )}
      {ticket.faultType && ticket.faultConfirmedAt && <p className="text-xs text-[#63749b]">Confirmed {formatDateTime(ticket.faultConfirmedAt)}.</p>}
      {repeat && (
        <div className={`rounded-lg p-3 text-sm ${repeat.isRepeat ? "bg-amber-50 text-amber-800" : "bg-[#f5f9ff] text-[#294477]"}`}>
          <strong>{repeat.isRepeat ? "Repeat fault: " : ""}</strong>
          {ticket.productNameEn ?? "This product"} has had “{ticket.faultType}” {repeat.count} time{repeat.count === 1 ? "" : "s"} in the last {repeat.windowDays} days
          {repeat.isRepeat ? ` (threshold ${repeat.threshold}).` : "."}
          {repeat.tickets.length > 1 && (
            <ul className="mt-2 space-y-0.5">
              {repeat.tickets
                .filter((t) => t.id !== ticket.id)
                .slice(0, 10)
                .map((t) => (
                  <li key={t.id}>
                    <Link className="underline" to={`/tickets/${t.id}`}>{t.ticketNo}</Link> · {t.customerCompany}
                    {t.productModel ? ` · ${t.productModel}` : ""}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
      {error && <div className="text-sm text-red-700">{error}</div>}
      {managing && <OptionSetModal title="Fault types" options={faultTypes} onClose={() => setManaging(false)} onSave={saveFaultTypes} />}
    </div>
  );
}
