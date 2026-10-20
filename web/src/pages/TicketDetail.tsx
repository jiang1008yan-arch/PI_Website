import { FormEvent, useEffect, useState } from "react";
import { ChevronLeft, LifeBuoy } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState, ErrorText, Field, PageHero, Section } from "../components/Form";
import { LookupInput } from "../components/LookupInput";
import type { MatchedPi, RepeatInfo, Ticket, TicketField, TicketStatus, TicketType, TicketUpdate, User } from "../types";
import { STATUS_BADGE, STATUS_LABEL, TICKET_TYPE_LABEL, TRANSITIONS, formatDateTime } from "../tickets/ticketShared";
import { TicketPiPanel } from "../tickets/TicketPiPanel";

type Detail = {
  ticket: Ticket;
  updates: TicketUpdate[];
  fields: TicketField[];
  matchedPis: MatchedPi[];
  device: { serialNumber: string; piId: string; piNo: string; linkedPiNo?: string | null; linkedPiNoSnapshot?: string | null } | null;
  repeat: RepeatInfo | null;
};

export function TicketDetailPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const canManage = user?.role === "ADMIN" || user?.role === "SERVICE";
  const isAdmin = user?.role === "ADMIN";

  const [data, setData] = useState<Detail | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await api.get(`/tickets/${id}`);
    setData(res.data);
  }

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

  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setError("");
    setBusy(true);
    try {
      await api.post(`/tickets/${id}/notes`, { note: note.trim() });
      setNote("");
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Could not add note.");
    } finally {
      setBusy(false);
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
            {canManage && <CustomerEditor ticket={ticket} onChanged={load} />}
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Info label="Company" value={ticket.customerCompany} />
              <Info label="Production order no." value={ticket.orderNo} />
              <Info label="Contact name" value={ticket.contactName} />
              <Info label="Contact details" value={ticket.contactInfo} />
            </dl>
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

          <TicketPiPanel
            ticket={ticket}
            matchedPis={data.matchedPis ?? []}
            device={data.device ?? null}
            repeat={data.repeat ?? null}
            canManage={canManage}
            onChanged={load}
          />

          <Section title="Activity">
            {updates.length === 0 ? (
              <EmptyState title="No activity yet" description="Status changes and notes will appear here." />
            ) : (
              <ol className="space-y-4">
                {updates.map((u) => (
                  <li key={u.id} className="border-l-2 border-[#e1e9f8] pl-4">
                    <div className="text-xs text-[#8595b6]">
                      {formatDateTime(u.createdAt)} · {u.actorName ?? "System"}
                    </div>
                    {u.kind === "STATUS" ? (
                      <div className="text-sm text-[#294477]">
                        Status changed{" "}
                        <span className="font-medium">{STATUS_LABEL[(u.statusFrom as TicketStatus) ?? "NEW"]}</span> →{" "}
                        <span className="font-medium">{STATUS_LABEL[(u.statusTo as TicketStatus) ?? "NEW"]}</span>
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap text-sm text-[#07183f]">{u.note}</div>
                    )}
                  </li>
                ))}
              </ol>
            )}

            {canManage && (
              <form onSubmit={addNote} className="border-t pt-4">
                <Field label="Add a note">
                  <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} />
                </Field>
                <button className="btn-primary mt-3" disabled={busy || !note.trim()}>
                  Add note
                </button>
              </form>
            )}
          </Section>
        </div>

        <div className="space-y-6">
          <TicketTypeSection ticket={ticket} canManage={canManage} onChanged={load} />

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

// Correct the customer and production order number, picking from existing
// approved PIs and customers; the change is logged on the ticket.
function CustomerEditor({ ticket, onChanged }: { ticket: Ticket; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [customerCompany, setCustomerCompany] = useState(ticket.customerCompany);
  const [orderNo, setOrderNo] = useState(ticket.orderNo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setCustomerCompany(ticket.customerCompany);
    setOrderNo(ticket.orderNo);
  }, [ticket.id, ticket.customerCompany, ticket.orderNo]);

  async function save() {
    setError("");
    setBusy(true);
    try {
      await api.patch(`/tickets/${ticket.id}/customer`, { customerCompany, orderNo });
      setOpen(false);
      await onChanged();
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mb-3 flex justify-end">
        <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => setOpen(true)}>
          Edit customer & production order
        </button>
      </div>
    );
  }
  return (
    <div className="mb-4 space-y-3 rounded-lg border border-[#e3ecff] bg-[#f8fbff] p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Customer company">
          <LookupInput kind="customer" value={customerCompany} onChange={setCustomerCompany} maxLength={200} />
        </Field>
        <Field label="Production order no.">
          <LookupInput
            kind="order"
            value={orderNo}
            onChange={setOrderNo}
            onPick={(m) => m.customerCompany && setCustomerCompany(m.customerCompany)}
            maxLength={100}
            placeholder="Type part of the order, PI no. or customer"
          />
        </Field>
      </div>
      {error && <div className="text-sm text-red-700">{error}</div>}
      <div className="flex gap-2">
        <button type="button" className="btn-primary" disabled={busy} onClick={save}>Save</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

// What the ticket is about. Only faults count in fault statistics; product
// requests also go to the product managers' requirement pool.
function TicketTypeSection({ ticket, canManage, onChanged }: { ticket: Ticket; canManage: boolean; onChanged: () => Promise<void> }) {
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
