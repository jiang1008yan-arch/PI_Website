import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { SimilarTickets } from "../types";
import { STATUS_BADGE, STATUS_LABEL } from "./ticketShared";

const LAYER_TITLE: Record<SimilarTickets["layers"][number]["key"], (value: string, days: number) => string> = {
  SN: (v) => `Same device (SN ${v})`,
  ORDER: (v) => `Same production order (${v})`,
  CUSTOMER: (v) => `Same customer (${v})`,
  FAULT: (v, days) => `Same fault type (${v}), last ${days} days`
};

// "Has this happened before?" on the New ticket page: earlier tickets with the
// same SN, production order, customer or fault (the same lookup the Feishu
// form shows), refreshed shortly after the fields change.
export function SimilarTicketsPanel(props: { serialNumber: string; orderNo: string; customerCompany: string; productId: string; faultType?: string }) {
  const [data, setData] = useState<SimilarTickets | null>(null);
  const { serialNumber, orderNo, customerCompany, productId, faultType } = props;
  const empty = !serialNumber.trim() && !orderNo.trim() && !customerCompany.trim() && !faultType?.trim();

  useEffect(() => {
    if (empty) {
      setData(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .get("/tickets/similar", { params: { serialNumber, orderNo, customerCompany, productId: productId || undefined, faultType: faultType || undefined } })
        .then((res) => !cancelled && setData(res.data))
        .catch(() => !cancelled && setData(null));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [serialNumber, orderNo, customerCompany, productId, faultType, empty]);

  if (empty || !data) return null;
  if (!data.layers.length) return <p className="text-sm text-[#63749b]">No earlier tickets for this device, order or customer.</p>;
  return (
    <div className="space-y-4">
      {data.layers.map((layer) => (
        <div key={layer.key} className="space-y-2">
          <div className="text-sm font-semibold text-[#294477]">
            {LAYER_TITLE[layer.key](layer.value, data.windowDays)} <span className="font-normal text-[#63749b]">({layer.total})</span>
          </div>
          {layer.openDuplicate && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle size={16} className="shrink-0" />
              This device already has an open ticket — check it before creating a duplicate.
            </div>
          )}
          <ul className="divide-y divide-[#edf2fb] rounded-lg border border-[#edf2fb]">
            {layer.tickets.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <Link to={`/tickets/${t.id}`} target="_blank" className="font-mono font-medium text-primary hover:underline">
                  {t.ticketNo}
                </Link>
                <span className="text-[#63749b]">{t.createdAt.slice(0, 10)}</span>
                <span className="text-[#294477]">{t.customerCompany || "—"}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                {t.summary && <span className="min-w-0 basis-full truncate text-[#63749b] sm:basis-auto sm:flex-1">{t.summary}</span>}
              </li>
            ))}
          </ul>
          {layer.total > layer.tickets.length && (
            <Link to={`/tickets?q=${encodeURIComponent(layer.value)}`} target="_blank" className="text-sm text-primary hover:underline">
              {layer.total - layer.tickets.length} more
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
