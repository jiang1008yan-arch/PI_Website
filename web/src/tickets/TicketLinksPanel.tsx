import { FormEvent, useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState, ErrorText, Field } from "../components/Form";
import type { TicketLink, User } from "../types";
import { formatDateTime } from "./ticketShared";

function publicUrl(token: string) {
  return `${window.location.origin}/ticket/new?t=${token}`;
}

export function TicketLinksPanel() {
  const { user } = useAuth();
  const role = user?.role;
  const isAdmin = role === "ADMIN";

  const [links, setLinks] = useState<TicketLink[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [customerCompany, setCustomerCompany] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [assignedSalesId, setAssignedSalesId] = useState("");
  const [assignedServiceId, setAssignedServiceId] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState("");

  async function load() {
    const res = await api.get("/ticket-links");
    setLinks(res.data);
  }

  useEffect(() => {
    load();
    api.get("/assignable-users").then((res) => setUsers(res.data)).catch(() => setUsers([]));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      await api.post("/ticket-links", {
        customerCompany: customerCompany.trim(),
        orderNo: orderNo.trim(),
        assignedSalesId: assignedSalesId || undefined,
        assignedServiceId: assignedServiceId || undefined
      });
      setCustomerCompany("");
      setOrderNo("");
      setAssignedSalesId("");
      setAssignedServiceId("");
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Could not create the link.");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(link: TicketLink) {
    if (!window.confirm("Revoke this link? Customers will no longer be able to use it.")) return;
    await api.post(`/ticket-links/${link.id}/revoke`);
    await load();
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(publicUrl(token));
      setCopied(token);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  const salesUsers = users.filter((u) => u.role === "SALES" || u.role === "ADMIN");
  const serviceUsers = users.filter((u) => u.role === "SERVICE" || u.role === "ADMIN");

  const canCreate = isAdmin
    ? Boolean(assignedSalesId || assignedServiceId)
    : role === "SALES"
      ? Boolean(assignedServiceId)
      : role === "SERVICE"
        ? Boolean(assignedSalesId)
        : false;
  const hint =
    role === "SALES"
      ? "You'll be set as the sales contact. Choose the service contact who should handle replies."
      : role === "SERVICE"
        ? "You'll be set as the service contact. Choose the sales contact for this customer."
        : "Assign at least one of sales or service.";

  return (
    <div className="space-y-6">
      <form onSubmit={create} className="space-y-4 rounded-lg border border-[#e8eef9] bg-[#f8fbff] p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Customer company">
            <input value={customerCompany} onChange={(e) => setCustomerCompany(e.target.value)} maxLength={200} />
          </Field>
          <Field label="Order number">
            <input value={orderNo} onChange={(e) => setOrderNo(e.target.value)} maxLength={100} />
          </Field>
        </div>
        {isAdmin && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Assign sales (optional)">
              <select value={assignedSalesId} onChange={(e) => setAssignedSalesId(e.target.value)}>
                <option value="">None</option>
                {salesUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName} ({u.role})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Assign service (optional)">
              <select value={assignedServiceId} onChange={(e) => setAssignedServiceId(e.target.value)}>
                <option value="">None</option>
                {serviceUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName} ({u.role})
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
        {role === "SALES" && (
          <Field label="Service contact *">
            <select value={assignedServiceId} required onChange={(e) => setAssignedServiceId(e.target.value)}>
              <option value="">Select the service contact…</option>
              {serviceUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName} ({u.role})
                </option>
              ))}
            </select>
          </Field>
        )}
        {role === "SERVICE" && (
          <Field label="Sales contact *">
            <select value={assignedSalesId} required onChange={(e) => setAssignedSalesId(e.target.value)}>
              <option value="">Select the sales contact…</option>
              {salesUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName} ({u.role})
                </option>
              ))}
            </select>
          </Field>
        )}
        <p className="text-xs text-[#8595b6]">{hint}</p>
        <ErrorText message={error} />
        <button className="btn-primary" disabled={creating || !canCreate}>
          {creating ? "Generating…" : "Generate link"}
        </button>
      </form>

      {links.length === 0 ? (
        <EmptyState title="No links yet" description="Generate a link above and share it with your customer." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[#8595b6]">
              <th className="py-2">Company</th>
              <th>Order</th>
              <th>Submissions</th>
              <th>Expires</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {links.map((l) => {
              const expired = new Date(l.expiresAt).getTime() < Date.now();
              const inactive = Boolean(l.revokedAt) || expired;
              return (
                <tr key={l.id} className="border-t">
                  <td className="py-3 font-medium text-[#07183f]">{l.customerCompany || "—"}</td>
                  <td>{l.orderNo || "—"}</td>
                  <td>{l.useCount ?? 0}</td>
                  <td className="text-[#63749b]">{formatDateTime(l.expiresAt)}</td>
                  <td>
                    {l.revokedAt ? (
                      <span className="text-red-600">Revoked</span>
                    ) : expired ? (
                      <span className="text-slate-500">Expired</span>
                    ) : (
                      <span className="text-green-600">Active</span>
                    )}
                  </td>
                  <td className="text-right">
                    <div className="flex justify-end gap-2">
                      <button type="button" className="btn-secondary flex items-center gap-1" onClick={() => copy(l.token)}>
                        <Copy size={14} />
                        {copied === l.token ? "Copied" : "Copy link"}
                      </button>
                      {!inactive && (
                        <button type="button" className="btn-danger" onClick={() => revoke(l)}>
                          Revoke
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
