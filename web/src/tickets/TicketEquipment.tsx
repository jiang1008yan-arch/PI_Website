import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { piDisplayName } from "../pi/labels";
import type { MatchedPi, Pi, Ticket } from "../types";
import { usePiLines } from "./usePiLines";

type DeviceMatch = { serialNumber: string; piId: string; piNo: string; linkedPiNo?: string | null; linkedPiNoSnapshot?: string | null } | null;

const piName = (p: { piNo: string; linkedPiNo?: string | null; linkedPiNoSnapshot?: string | null }) =>
  piDisplayName({ ...(p as any), language: "ZH" } as Pi, "ZH");

// The equipment a ticket is about, all derived from existing records: the
// approved PI its production order number points at, the PI line (product and
// model) and the device SN. SNs come from other systems (registered on the PI,
// later from the charger backend) and are only picked here, never typed; with
// none on record the SN row is left out.
export function TicketEquipment({
  ticket,
  matchedPis,
  device,
  canManage,
  onChanged
}: {
  ticket: Ticket;
  matchedPis: MatchedPi[];
  device: DeviceMatch;
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const pi = matchedPis[0] ?? null;
  const lineOptions = usePiLines(pi?.id);
  const [serials, setSerials] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSerials([]);
    if (!pi) return;
    api
      .get(`/lookup/pi/${pi.id}/devices`)
      .then((res) => setSerials(res.data))
      .catch(() => setSerials([]));
  }, [pi?.id]);

  const currentLine = lineOptions.find((o) => o.productId === ticket.productId && (o.model || null) === (ticket.productModel || null));
  // The ticket's SN stays selectable even if it came from elsewhere (e.g. a device alert).
  const serialOptions = ticket.serialNumber && !serials.includes(ticket.serialNumber) ? [ticket.serialNumber, ...serials] : serials;

  async function save(payload: Record<string, unknown>) {
    setError("");
    setBusy(true);
    try {
      await api.patch(`/tickets/${ticket.id}/product`, payload);
      await onChanged();
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-[#8595b6]">Equipment</h3>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-[#8595b6]">Approved PI</dt>
          <dd className="mt-0.5 text-sm">
            {pi ? (
              <>
                <Link className="font-medium text-primary underline" to={`/pi/view/${pi.id}`}>{piName(pi)}</Link>
                {Boolean(pi.revisionInProgress) && <span className="ml-2 text-xs text-amber-700">(revision in progress)</span>}
                {matchedPis.length > 1 && <div className="text-xs text-amber-700">Several PIs use this production order number; the first is used.</div>}
              </>
            ) : (
              <span className="text-[#63749b]">{ticket.orderNo ? "No approved PI for this production order" : "Set the production order no. above"}</span>
            )}
          </dd>
        </div>

        <div>
          <dt className="text-xs uppercase tracking-wide text-[#8595b6]">Product / model</dt>
          <dd className="mt-0.5 text-sm text-[#07183f]">
            {canManage && lineOptions.length > 0 ? (
              <select
                className="w-full"
                value={currentLine?.key ?? ""}
                disabled={busy}
                onChange={(e) => {
                  const chosen = lineOptions.find((o) => o.key === e.target.value);
                  if (chosen) void save({ productId: chosen.productId, productModel: chosen.model || null });
                }}
              >
                <option value="">{ticket.productNameEn ? `${ticket.productNameEn} — pick the PI line…` : "Pick the PI line…"}</option>
                {lineOptions.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            ) : (
              <>
                {ticket.productNameEn ?? "—"}
                {ticket.productModel ? ` · ${ticket.productModel}` : ""}
              </>
            )}
          </dd>
        </div>

        {(serialOptions.length > 0 || ticket.serialNumber) && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-[#8595b6]">Device SN</dt>
            <dd className="mt-0.5 text-sm text-[#07183f]">
              {canManage && serialOptions.length > 0 ? (
                <select
                  className="w-full font-mono"
                  value={ticket.serialNumber ?? ""}
                  disabled={busy}
                  onChange={(e) => void save({ serialNumber: e.target.value || null })}
                >
                  <option value="">Not specified</option>
                  {serialOptions.map((sn) => (
                    <option key={sn} value={sn}>{sn}</option>
                  ))}
                </select>
              ) : (
                <span className="font-mono">{ticket.serialNumber}</span>
              )}
              {device && pi && device.piId !== pi.id && (
                <div className="mt-1 text-xs text-amber-700">
                  This SN is registered on <Link className="underline" to={`/pi/view/${device.piId}`}>{piName(device)}</Link>.
                </div>
              )}
            </dd>
          </div>
        )}
      </dl>
      {error && <div className="text-sm text-red-700">{error}</div>}
    </div>
  );
}
