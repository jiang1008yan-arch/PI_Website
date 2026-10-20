import { KeyboardEvent, useEffect, useState } from "react";
import { ChevronLeft, LifeBuoy } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ErrorText, Field, PageHero, Section } from "../components/Form";
import { LookupInput } from "../components/LookupInput";
import type { MatchedPi, RepeatInfo, Ticket, TicketAttachment, TicketField, TicketStatus, TicketType, TicketUpdate, User } from "../types";
import { STATUS_BADGE, STATUS_LABEL, TICKET_TYPE_LABEL, TRANSITIONS, formatDateTime } from "../tickets/ticketShared";
import { markSeen } from "../pi/notifications";
import { TicketActivity } from "../tickets/TicketActivity";
import { TicketEquipment } from "../tickets/TicketEquipment";
import { TicketFault } from "../tickets/TicketFault";

type Detail = {
  ticket: Ticket;
  updates: TicketUpdate[];
  fields: TicketField[];
  matchedPis: MatchedPi[];
  device: { serialNumber: string; piId: string; piNo: string; linkedPiNo?: string | null; linkedPiNoSnapshot?: string | null } | null;
  repeat: RepeatInfo | null;
  attachments: TicketAttachment[];
};

export function TicketDetailPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const canManage = user?.role === "ADMIN" || user?.role === "SERVICE";
  const isAdmin = user?.role === "ADMIN";

  const [data, setData] = useState<Detail | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await api.get(`/tickets/${id}`);
    setData(res.data);
  }

  useEffect(() => {
    markSeen(["newTickets"], user?.id, [id]);
  }, [id, user?.id]);

  useEffect(() => {
    load();
    // All roles can pick an assignee for their own side, so fetch the roster for everyone.
    api.get("/assignable-users").then((res) => setUsers(res.data)).catch(() => setUsers([]));
  }, [id]);

  async function changeStatus(to: TicketStatus) {
    setError("");
    setBusy(true);
    try {
      await api.patch(`/tickets/${id}/status`, { status: to });
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Could not change status.");
    } finally {
      setBusy(false);
    }
  }

  // Saves one customer/contact field edited in place.
  async function saveCustomerField(field: "customerCompany" | "orderNo" | "contactName" | "contactInfo", value: string) {
    setError("");
    try {
      await api.patch(`/tickets/${id}/customer`, { [field]: value });
      await load();
      return true;
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Could not save.");
      return false;
    }
  }

  async function assign(payload: { assignedSalesId?: string | null; assignedServiceId?: string | null }) {
    setError("");
    setBusy(true);
    try {
      await api.patch(`/tickets/${id}/assign`, payload);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Could not update assignment.");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className="py-10 text-center text-sm text-[#63749b]">Loading…</div>;

  const { ticket, updates, fields } = data;
  let parsedAnswers: Record<string, string> = {};
  try {
    parsedAnswers = JSON.parse(ticket.answers || "{}");
  } catch {
    parsedAnswers = {};
  }
  const transitions = TRANSITIONS[ticket.status] ?? [];
  // A ticket is classified (and a fault confirmed) before it can be resolved.
  const resolveBlocker = !ticket.ticketType
    ? "Choose the ticket type before resolving."
    : ticket.ticketType === "FAULT" && !ticket.faultType
      ? "Confirm the fault type before resolving."
      : "";
  const salesUsers = users.filter((u) => u.role === "SALES" || u.role === "ADMIN");
  const serviceUsers = users.filter((u) => u.role === "SERVICE" || u.role === "ADMIN");

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="After-sales"
        title={ticket.ticketNo}
        description={`${ticket.customerCompany || "—"} · Production Order No. ${ticket.orderNo || "—"}`}
        Icon={LifeBuoy}
        action={
          <Link
            to="/tickets"
            className="inline-flex items-center gap-1 text-sm font-medium text-[#63749b] transition hover:text-primary hover:underline"
          >
            <ChevronLeft size={16} />
            Back
          </Link>
        }
      />

      <ErrorText message={error} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Section title="Customer & request">
            {canManage && <p className="-mt-2 mb-3 text-xs text-[#8595b6]">Double-click a value to change it. Enter saves, Esc cancels.</p>}
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <EditableInfo label="Company" value={ticket.customerCompany} lookup="customer" canEdit={canManage} maxLength={200} onSave={(v) => saveCustomerField("customerCompany", v)} />
              <EditableInfo label="Production order no." value={ticket.orderNo} lookup="order" canEdit={canManage} maxLength={100} onSave={(v) => saveCustomerField("orderNo", v)} />
              <EditableInfo label="Contact name" value={ticket.contactName} canEdit={canManage} maxLength={200} required onSave={(v) => saveCustomerField("contactName", v)} />
              <EditableInfo label="Contact details" value={ticket.contactInfo} canEdit={canManage} maxLength={200} required onSave={(v) => saveCustomerField("contactInfo", v)} />
            </dl>
            <TicketEquipment ticket={ticket} matchedPis={data.matchedPis ?? []} device={data.device ?? null} canManage={canManage} onChanged={load} />
            <div className="border-t pt-4">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#8595b6]">Questionnaire</h3>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Info label="Product (as reported)" value={ticket.productNameEn ?? "—"} />
                {fields.map((f) => (
                  <Info key={f.id} label={f.label} value={parsedAnswers[f.id!] || "—"} />
                ))}
              </dl>
            </div>
          </Section>

          <TicketActivity ticket={ticket} updates={updates} attachments={data.attachments ?? []} canManage={canManage} onChanged={load} />

        </div>

        <div className="space-y-6">
          <TicketTypeSection ticket={ticket} repeat={data.repeat ?? null} canManage={canManage} onChanged={load} />

          <Section title="Status">
            <div className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${STATUS_BADGE[ticket.status]}`}>
              {STATUS_LABEL[ticket.status]}
            </div>
            {canManage ? (
              transitions.length > 0 ? (
                <div className="mt-4 space-y-2">
                  {transitions.map((to) => (
                    <button
                      key={to}
                      type="button"
                      className="btn-secondary w-full"
                      disabled={busy || (to === "RESOLVED" && Boolean(resolveBlocker))}
                      title={to === "RESOLVED" ? resolveBlocker : undefined}
                      onClick={() => changeStatus(to)}
                    >
                      Move to {STATUS_LABEL[to]}
                    </button>
                  ))}
                  {transitions.includes("RESOLVED") && resolveBlocker && <p className="text-xs text-amber-700">{resolveBlocker}</p>}
                </div>
              ) : (
                <p className="mt-3 text-sm text-[#8595b6]">No further transitions.</p>
              )
            ) : (
              <p className="mt-3 text-sm text-[#8595b6]">Read-only for your role.</p>
            )}
          </Section>

          <Section title="Assignees">
            <div className="space-y-4">
              <AssigneeControl
                label="Sales"
                currentName={ticket.assignedSalesName}
                canEdit={isAdmin || user?.role === "SALES"}
                users={salesUsers}
                currentId={ticket.assignedSalesId}
                busy={busy}
                onSet={(value) => assign({ assignedSalesId: value })}
              />
              <AssigneeControl
                label="Service"
                currentName={ticket.assignedServiceName}
                canEdit={isAdmin || user?.role === "SERVICE"}
                users={serviceUsers}
                currentId={ticket.assignedServiceId}
                busy={busy}
                onSet={(value) => assign({ assignedServiceId: value })}
              />
            </div>
          </Section>

          <Section title="Details">
            <dl className="space-y-2 text-sm">
              <Info label="Ticket number" value={ticket.ticketNo} />
              <Info label="Created" value={formatDateTime(ticket.createdAt)} />
              <Info label="Updated" value={formatDateTime(ticket.updatedAt)} />
              <Info label="Source" value={ticket.linkId ? "Customer link" : "Created in platform"} />
            </dl>
          </Section>
        </div>
      </div>
    </div>
  );
}

// A value that turns into an input on double-click (with type-ahead for
// company and production order); Enter or leaving the field saves, Esc cancels.
function EditableInfo({
  label,
  value,
  canEdit,
  lookup,
  maxLength,
  required,
  onSave
}: {
  label: string;
  value?: string | null;
  canEdit: boolean;
  lookup?: "customer" | "order";
  maxLength: number;
  required?: boolean;
  onSave: (value: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);

  function start() {
    if (!canEdit) return;
    setDraft(value ?? "");
    setEditing(true);
  }
  async function commit() {
    if (saving) return;
    const next = draft.trim();
    if (next === (value ?? "") || (required && !next)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const ok = await onSave(next);
    setSaving(false);
    if (ok) setEditing(false);
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // A suggestion list handles its own Enter (picking an item).
    if (e.key === "Enter" && !e.defaultPrevented) {
      e.preventDefault();
      void commit();
    } else if (e.key === "Escape") {
      setEditing(false);
    }
  }

  if (!editing) {
    return (
      <div>
        <dt className="text-xs uppercase tracking-wide text-[#8595b6]">{label}</dt>
        <dd
          className={`-mx-1 mt-0.5 rounded px-1 text-sm text-[#07183f] ${canEdit ? "cursor-text hover:bg-[#f1f5ff]" : ""}`}
          title={canEdit ? "Double-click to edit" : undefined}
          onDoubleClick={start}
        >
          {value || "—"}
        </dd>
      </div>
    );
  }
  return (
    <div onKeyDown={onKeyDown} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && void commit()}>
      <dt className="text-xs uppercase tracking-wide text-[#8595b6]">{label}</dt>
      <dd className="mt-0.5">
        {lookup ? (
          <LookupInput
            kind={lookup}
            value={draft}
            onChange={setDraft}
            maxLength={maxLength}
            disabled={saving}
            autoFocus
            placeholder={lookup === "order" ? "Type part of the order, PI no. or customer" : undefined}
          />
        ) : (
          <input autoFocus className="w-full" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={maxLength} disabled={saving} />
        )}
      </dd>
    </div>
  );
}

// What the ticket is about. Only faults count in fault statistics; product
// requests also go to the product managers' requirement pool.
function TicketTypeSection({
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
  // Faults (and tickets not classified yet) carry the confirmed fault type.
  const showFault = ticket.ticketType !== "PRODUCT_REQUEST" && ticket.ticketType !== "OTHER";
  const [type, setType] = useState<TicketType | "">(ticket.ticketType ?? "");
  const [summary, setSummary] = useState(ticket.summary ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setType(ticket.ticketType ?? "");
    setSummary(ticket.summary ?? "");
  }, [ticket.id, ticket.ticketType, ticket.summary]);

  async function save() {
    setError("");
    setBusy(true);
    try {
      await api.patch(`/tickets/${ticket.id}/type`, { ticketType: type, summary });
      await onChanged();
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Could not save the ticket type.");
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) {
    return (
      <Section title="Type">
        <dl className="space-y-2 text-sm">
          <Info label="Ticket type" value={ticket.ticketType ? TICKET_TYPE_LABEL[ticket.ticketType] : "Not classified yet"} />
          <Info label="Summary" value={ticket.summary} />
        </dl>
        {showFault && <TicketFault ticket={ticket} repeat={repeat} canManage={false} onChanged={onChanged} />}
      </Section>
    );
  }
  const changed = type !== (ticket.ticketType ?? "") || summary.trim() !== (ticket.summary ?? "");
  return (
    <Section title="Type">
      <div className="space-y-3">
        <Field label="Ticket type">
          <select value={type} onChange={(e) => setType(e.target.value as TicketType | "")}>
            <option value="">Not classified yet</option>
            {(Object.keys(TICKET_TYPE_LABEL) as TicketType[]).map((t) => (
              <option key={t} value={t}>{TICKET_TYPE_LABEL[t]}</option>
            ))}
          </select>
        </Field>
        <Field label="One-line summary">
          <input value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={300} placeholder="What the customer reports or asks for" />
        </Field>
        {type === "PRODUCT_REQUEST" && ticket.ticketType !== "PRODUCT_REQUEST" && (
          <p className="text-xs text-[#63749b]">Saving sends this request to the product managers' requirement pool in Feishu.</p>
        )}
        {type && type !== "FAULT" && ticket.faultType && <p className="text-xs text-amber-700">The confirmed fault type will be cleared.</p>}
        <button type="button" className="btn-secondary" disabled={busy || !type || !changed} onClick={save}>
          Save type
        </button>
        {error && <div className="text-sm text-red-700">{error}</div>}
        {showFault && <TicketFault ticket={ticket} repeat={repeat} canManage onChanged={onChanged} />}
      </div>
    </Section>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[#8595b6]">{label}</dt>
      <dd className="mt-0.5 text-sm text-[#07183f]">{value || "—"}</dd>
    </div>
  );
}

function AssigneeControl({
  label,
  currentName,
  currentId,
  canEdit,
  users,
  busy,
  onSet
}: {
  label: string;
  currentName?: string | null;
  currentId?: string | null;
  canEdit: boolean;
  users: User[];
  busy: boolean;
  onSet: (value: string | null) => void;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-[#8595b6]">{label}</div>
      {canEdit ? (
        <select
          className="mt-2"
          value={currentId ?? ""}
          disabled={busy}
          onChange={(e) => onSet(e.target.value || null)}
        >
          <option value="">Unassigned</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName} ({u.role})
            </option>
          ))}
        </select>
      ) : (
        <div className="mt-1 text-sm text-[#07183f]">{currentName || "Unassigned"}</div>
      )}
    </div>
  );
}
