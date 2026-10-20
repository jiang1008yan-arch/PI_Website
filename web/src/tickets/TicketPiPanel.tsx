import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { Field, Section } from "../components/Form";
import { piDisplayName } from "../pi/labels";
import { generatedModelFor } from "../pi/modelRule";
import { OptionSetModal } from "../pi/OptionSetModal";
import { parsePiItems, type ParsedPiItem } from "../pi/piItemCodec";
import { SelectWithManage } from "../pi/SelectWithManage";
import type { MatchedPi, Pi, RepeatInfo, Ticket } from "../types";
import { formatDateTime } from "./ticketShared";

type DeviceMatch = { serialNumber: string; piId: string; piNo: string; linkedPiNo?: string | null; linkedPiNoSnapshot?: string | null } | null;

// The after-sales side of a ticket: which approved PI it belongs to (matched by
// production order number, or by device SN), which PI line and SN the issue is
// about, and the confirmed fault type — with how often that fault has hit the
// same product recently.
export function TicketPiPanel({
  ticket,
  matchedPis,
  device,
  repeat,
  canManage,
  onChanged
}: {
  ticket: Ticket;
  matchedPis: MatchedPi[];
  device: DeviceMatch;
  repeat: RepeatInfo | null;
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const pi = matchedPis[0] ?? null;
  const [lines, setLines] = useState<ParsedPiItem[]>([]);
  const [line, setLine] = useState("");
  const [serial, setSerial] = useState(ticket.serialNumber ?? "");
  const [faultTypes, setFaultTypes] = useState<string[]>([]);
  const [fault, setFault] = useState(ticket.faultType ?? "");
  const [managing, setManaging] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Product lines of the matched PI's effective (approved) Chinese version.
  useEffect(() => {
    setLines([]);
    if (!pi) return;
    api
      .get(`/pi/${pi.id}/view`)
      .then((res) => {
        const zh = res.data.zh.effective ?? res.data.zh.current;
        setLines(zh ? parsePiItems(zh.items ?? []) : []);
      })
      .catch(() => setLines([]));
  }, [pi?.id]);

  const loadFaultTypes = () => api.get("/options/faultType").then((res) => setFaultTypes(res.data.map((r: any) => r.value)));
  useEffect(() => { void loadFaultTypes(); }, []);
  useEffect(() => { setFault(ticket.faultType ?? ""); setSerial(ticket.serialNumber ?? ""); }, [ticket.id, ticket.faultType, ticket.serialNumber]);

  const lineOptions = useMemo(
    () =>
      lines.map((item, idx) => ({
        key: String(idx),
        productId: item.productId,
        model: generatedModelFor(item).model,
        label: `${item.nameZh || item.nameEn || item.code || item.productId}${generatedModelFor(item).model ? ` · ${generatedModelFor(item).model}` : ""} · qty ${item.quantity}`
      })),
    [lines]
  );
  // Preselect the line matching what is recorded on the ticket.
  useEffect(() => {
    const match = lineOptions.find((o) => o.productId === ticket.productId && (o.model || null) === (ticket.productModel || null));
    setLine(match?.key ?? "");
  }, [lineOptions, ticket.productId, ticket.productModel]);

  async function run(task: () => Promise<unknown>) {
    setError("");
    setBusy(true);
    try {
      await task();
      await onChanged();
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message ?? "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  const saveProduct = () =>
    run(async () => {
      const chosen = lineOptions.find((o) => o.key === line);
      await api.patch(`/tickets/${ticket.id}/product`, {
        productId: chosen?.productId ?? ticket.productId,
        productModel: chosen ? chosen.model : ticket.productModel,
        serialNumber: serial
      });
    });
  const confirmFault = () => run(() => api.patch(`/tickets/${ticket.id}/fault`, { faultType: fault }));
  async function saveFaultTypes(values: string[]) {
    await api.put("/options/faultType", { values });
    setManaging(false);
    await loadFaultTypes();
  }

  const piName = (p: { piNo: string; linkedPiNo?: string | null; linkedPiNoSnapshot?: string | null }) =>
    piDisplayName({ ...(p as any), language: "ZH" } as Pi, "ZH");

  return (
    <Section title="Approved PI & fault">
      <div className="space-y-4">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#8595b6]">Approved PI</h3>
          {matchedPis.length === 0 ? (
            <p className="text-sm text-[#63749b]">
              {ticket.orderNo ? `No approved PI found for production order no. ${ticket.orderNo}.` : "No production order number on this ticket."}
            </p>
          ) : (
            <ul className="space-y-1">
              {matchedPis.map((p) => (
                <li key={p.id} className="text-sm">
                  <Link className="font-medium text-primary underline" to={`/pi/view/${p.id}`}>{piName(p)}</Link>
                  <span className="text-[#63749b]"> · {p.customerCompany}</span>
                  {Boolean(p.revisionInProgress) && <span className="ml-2 text-xs text-amber-700">(revision in progress)</span>}
                </li>
              ))}
              {matchedPis.length > 1 && <li className="text-xs text-amber-700">Several PIs use this production order number; the first is used below.</li>}
            </ul>
          )}
          {device && device.piId !== pi?.id && (
            <p className="mt-2 text-sm">
              SN {device.serialNumber} is registered on <Link className="text-primary underline" to={`/pi/view/${device.piId}`}>{piName(device)}</Link>.
            </p>
          )}
        </div>

        <div className="space-y-3 border-t pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[#8595b6]">Product line & device</h3>
          {canManage ? (
            <>
              <Field label="PI product line">
                <select value={line} onChange={(e) => setLine(e.target.value)} disabled={!lineOptions.length}>
                  <option value="">{lineOptions.length ? "Select the line this issue is about…" : `Keep: ${ticket.productNameEn ?? "—"}`}</option>
                  {lineOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Device SN (optional)">
                <input className="font-mono" value={serial} onChange={(e) => setSerial(e.target.value)} maxLength={64} placeholder="e.g. CHG-2026-0001" />
              </Field>
              <button type="button" className="btn-secondary" disabled={busy} onClick={saveProduct}>Save product line</button>
            </>
          ) : (
            <dl className="space-y-1 text-sm">
              <div><span className="text-[#8595b6]">Product:</span> {ticket.productNameEn ?? "—"}</div>
              <div><span className="text-[#8595b6]">Model:</span> {ticket.productModel || "—"}</div>
              <div><span className="text-[#8595b6]">SN:</span> {ticket.serialNumber || "—"}</div>
            </dl>
          )}
          {canManage && (ticket.productModel || ticket.serialNumber) && (
            <p className="text-xs text-[#63749b]">Recorded: {ticket.productModel || "no model"}{ticket.serialNumber ? ` · SN ${ticket.serialNumber}` : ""}</p>
          )}
        </div>

        <div className="space-y-3 border-t pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[#8595b6]">Confirmed fault type</h3>
          {ticket.ticketType === "PRODUCT_REQUEST" || ticket.ticketType === "OTHER" ? (
            <p className="text-sm text-[#63749b]">Only faults have a fault type. Change the ticket type to Fault to confirm one.</p>
          ) : canManage ? (
            <>
              <SelectWithManage label="Fault type" value={fault} options={faultTypes} disabled={busy} canManage onChange={setFault} onManage={() => setManaging(true)} />
              <button type="button" className="btn-secondary" disabled={busy || !fault || fault === ticket.faultType} onClick={confirmFault}>
                Confirm fault type
              </button>
            </>
          ) : (
            <div className="text-sm">{ticket.faultType || "Not confirmed yet"}</div>
          )}
          {ticket.faultType && (
            <p className="text-xs text-[#63749b]">Confirmed {ticket.faultConfirmedAt ? formatDateTime(ticket.faultConfirmedAt) : ""}. The customer's own answer in the questionnaire is for reference only.</p>
          )}
          {repeat && (
            <div className={`rounded-lg p-3 text-sm ${repeat.isRepeat ? "bg-amber-50 text-amber-800" : "bg-[#f5f9ff] text-[#294477]"}`}>
              <strong>{repeat.isRepeat ? "Repeat fault: " : ""}</strong>
              {ticket.productNameEn ?? "This product"} has had “{ticket.faultType}” {repeat.count} time{repeat.count === 1 ? "" : "s"} in the last {repeat.windowDays} days
              {repeat.isRepeat ? ` (threshold ${repeat.threshold}).` : "."}
              {repeat.tickets.length > 1 && (
                <ul className="mt-2 space-y-0.5">
                  {repeat.tickets.filter((t) => t.id !== ticket.id).slice(0, 10).map((t) => (
                    <li key={t.id}>
                      <Link className="underline" to={`/tickets/${t.id}`}>{t.ticketNo}</Link> · {t.customerCompany}
                      {t.productModel ? ` · ${t.productModel}` : ""} · {formatDateTime(t.createdAt)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {error && <div className="text-sm text-red-700">{error}</div>}
      </div>

      {managing && (
        <OptionSetModal title="Fault types" options={faultTypes} onClose={() => setManaging(false)} onSave={saveFaultTypes} />
      )}
    </Section>
  );
}
