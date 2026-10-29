import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { api } from "../api/client";

// A text input that suggests values the system already has — production order
// numbers (approved PIs), customer names (PIs and tickets) or device SNs — after
// two typed characters. Picking one hands back the whole match so callers can
// fill related fields; typing freely still works for values not in the system.

export type OrderMatch = { productionOrderNo: string; customerCompany: string; piId: string; piNo: string; linkedPiNo: string | null };
export type CustomerMatch = { customerCompany: string; piCount: number; ticketCount: number };
export type DeviceMatch = { serialNumber: string; piId: string; piNo: string; productionOrderNo: string; customerCompany: string };

type Kind = "order" | "customer" | "sn";
type MatchOf<K extends Kind> = K extends "order" ? OrderMatch : K extends "customer" ? CustomerMatch : DeviceMatch;

const piName = (m: { piNo: string; linkedPiNo?: string | null }) => (m.linkedPiNo ? `${m.piNo} / ${m.linkedPiNo}` : m.piNo);

function describe(kind: Kind, m: any): { main: string; sub: string; value: string } {
  if (kind === "order") return { main: m.productionOrderNo, sub: `${m.customerCompany || "—"} · ${piName(m)}`, value: m.productionOrderNo };
  if (kind === "sn") return { main: m.serialNumber, sub: `${m.productionOrderNo || "—"} · ${m.customerCompany || "—"}`, value: m.serialNumber };
  const counts = [m.piCount ? `${m.piCount} PI${m.piCount > 1 ? "s" : ""}` : "", m.ticketCount ? `${m.ticketCount} ticket${m.ticketCount > 1 ? "s" : ""}` : ""];
  return { main: m.customerCompany, sub: counts.filter(Boolean).join(" · "), value: m.customerCompany };
}

export function LookupInput<K extends Kind>({
  kind,
  value,
  onChange,
  onPick,
  placeholder,
  maxLength,
  className,
  disabled,
  autoFocus
}: {
  kind: K;
  value: string;
  onChange: (value: string) => void;
  onPick?: (match: MatchOf<K>) => void;
  placeholder?: string;
  maxLength?: number;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const [items, setItems] = useState<MatchOf<K>[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = useRef(false); // only look up what the user typed, not a picked value

  useEffect(() => {
    const q = value.trim();
    if (!typed.current || q.length < 2) {
      setItems([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api
        .get("/lookup", { params: { q, kind } })
        .then((res) => {
          const list = (kind === "order" ? res.data.orders : kind === "sn" ? res.data.devices : res.data.customers) as MatchOf<K>[];
          setItems(list);
          setActive(-1);
          setOpen(true);
        })
        .catch(() => setItems([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [value, kind]);

  function pick(m: MatchOf<K>) {
    typed.current = false;
    onChange(describe(kind, m).value);
    onPick?.(m);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || !items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(items[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <input
        value={value}
        className={`w-full ${className ?? ""}`}
        placeholder={placeholder ?? "Type 2+ characters to search"}
        maxLength={maxLength}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && items.length > 0}
        onChange={(e) => {
          typed.current = true;
          onChange(e.target.value);
        }}
        onFocus={() => items.length && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {open && items.length > 0 && (
        <ul role="listbox" className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-auto rounded-lg border border-[#dbe6fb] bg-white py-1 shadow-[0_12px_32px_rgba(8,36,107,0.12)]">
          {items.map((m, i) => {
            const d = describe(kind, m);
            return (
              <li
                key={`${d.value}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`cursor-pointer px-3 py-2 text-sm ${i === active ? "bg-[#eef3ff]" : "hover:bg-[#f5f8ff]"}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(m);
                }}
              >
                <div className="font-medium text-[#07183f]">{d.main}</div>
                {d.sub && <div className="text-xs text-[#63749b]">{d.sub}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
