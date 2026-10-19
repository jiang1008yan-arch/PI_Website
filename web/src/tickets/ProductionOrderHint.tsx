import { useEffect, useState } from "react";
import { api } from "../api/client";
import { piDisplayName } from "../pi/labels";
import type { Pi } from "../types";

// Under a "Production order no." input: shows the approved Chinese PI that
// number belongs to, and offers to take its customer company. Old orders from
// before the platform simply show no match — the number can still be typed.
export function ProductionOrderHint({ orderNo, onUseCompany }: { orderNo: string; onUseCompany: (company: string) => void }) {
  const [matches, setMatches] = useState<Pi[]>([]);

  useEffect(() => {
    const value = orderNo.trim();
    if (value.length < 3) {
      setMatches([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api
        .get("/pi/approved", { params: { q: value } })
        .then((res) => setMatches((res.data.items as Pi[]).filter((p) => String(p.productionOrderNo ?? "").trim() === value)))
        .catch(() => setMatches([]));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [orderNo]);

  if (!orderNo.trim() || matches.length === 0) return null;
  const pi = matches[0];
  return (
    <div className="mt-1 text-xs text-[#294477]">
      Approved PI {piDisplayName(pi, "ZH")} · {pi.customerCompany}{" "}
      <button type="button" className="text-primary underline" onClick={() => onUseCompany(pi.customerCompany)}>
        Use this customer
      </button>
    </div>
  );
}
