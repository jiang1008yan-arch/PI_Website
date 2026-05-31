import { FormEvent, useEffect, useState } from "react";
import { ChevronLeft, LifeBuoy } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState, ErrorText, Field, PageHero, Section } from "../components/Form";
import type { Ticket, TicketField, TicketStatus, TicketUpdate, User } from "../types";
import { STATUS_BADGE, STATUS_LABEL, TRANSITIONS, formatDateTime } from "../tickets/ticketShared";

type Detail = { ticket: Ticket; updates: TicketUpdate[]; fields: TicketField[] };

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
  const salesUsers = users.filter((u) => u.role === "SALES" || u.role === "ADMIN");
  const serviceUsers = users.filter((u) => u.role === "SERVICE" || u.role === "ADMIN");

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="After-sales"
        title={ticket.ticketNo}
        description={`${ticket.customerCompany || "—"} · Order ${ticket.orderNo || "—"}`}
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
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Info label="Company" value={ticket.customerCompany} />
              <Info label="Order number" value={ticket.orderNo} />
              <Info label="Contact name" value={ticket.contactName} />
              <Info label="Contact details" value={ticket.contactInfo} />
            </dl>
            <div className="border-t pt-4">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#8595b6]">Questionnaire</h3>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Info label="Product" value={ticket.productNameEn ?? "—"} />
                {fields.map((f) => (
                  <Info key={f.id} label={f.label} value={parsedAnswers[f.id!] || "—"} />
                ))}
              </dl>
            </div>
          </Section>

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
                      disabled={busy}
                      onClick={() => changeStatus(to)}
                    >
                      Move to {STATUS_LABEL[to]}
                    </button>
                  ))}
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
