import { FormEvent, useEffect, useMemo, useState } from "react";
import { ChevronLeft, LifeBuoy } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ErrorText, Field, PageHero, Section } from "../components/Form";
import { LookupInput } from "../components/LookupInput";
import { ticketProductOptionLabel } from "../tickets/productOptionLabel";
import { usePiLines } from "../tickets/usePiLines";
import type { PublicProduct, TicketField, User } from "../types";

function parseFields(raw: any[]): TicketField[] {
  return raw.map((f) => ({ ...f, options: JSON.parse(f.options || "[]") }));
}

export function CreateTicketPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [fields, setFields] = useState<TicketField[]>([]);
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  const [customerCompany, setCustomerCompany] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactInfo, setContactInfo] = useState("");
  const [productId, setProductId] = useState("");
  // The approved PI picked through the production order or SN: its product
  // lines replace the catalog list, so product and model match the PI.
  const [piId, setPiId] = useState<string | null>(null);
  const [lineKey, setLineKey] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const lineOptions = usePiLines(piId);
  // SNs come from other systems: only those registered on the picked PI.
  const [piSerials, setPiSerials] = useState<string[]>([]);
  useEffect(() => {
    setPiSerials([]);
    setSerialNumber("");
    if (!piId) return;
    api.get(`/lookup/pi/${piId}/devices`).then((res) => setPiSerials(res.data)).catch(() => setPiSerials([]));
  }, [piId]);
  const line = lineOptions.find((o) => o.key === lineKey) ?? null;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [assignedSalesId, setAssignedSalesId] = useState("");
  const [assignedServiceId, setAssignedServiceId] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const [f, p, u] = await Promise.all([
        api.get("/ticket-fields"),
        api.get("/tickets/products"),
        api.get("/assignable-users")
      ]);
      setFields(parseFields(f.data));
      setProducts(p.data);
      setUsers(u.data);
    })().catch(() => setError("Could not load the form."));
  }, []);

  // Pre-fill the creator's own side, mirroring the link flow.
  useEffect(() => {
    if (user?.role === "SALES") setAssignedSalesId((v) => v || user.id);
    if (user?.role === "SERVICE") setAssignedServiceId((v) => v || user.id);
  }, [user]);

  const salesUsers = users.filter((u) => u.role === "SALES" || u.role === "ADMIN");
  const serviceUsers = users.filter((u) => u.role === "SERVICE" || u.role === "ADMIN");

  const effectiveProductId = line?.productId ?? productId;
  const canSubmit = useMemo(
    () => Boolean(contactName.trim() && contactInfo.trim() && effectiveProductId),
    [contactName, contactInfo, effectiveProductId]
  );

  function applyPi(next: { piId: string; productionOrderNo: string; customerCompany: string }) {
    if (next.piId === piId) return;
    setPiId(next.piId);
    setLineKey("");
    setOrderNo(next.productionOrderNo);
    if (next.customerCompany) setCustomerCompany(next.customerCompany);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await api.post("/tickets", {
        customerCompany: customerCompany.trim(),
        orderNo: orderNo.trim(),
        contactName: contactName.trim(),
        contactInfo: contactInfo.trim(),
        productId: effectiveProductId,
        productModel: line?.model || undefined,
        serialNumber: serialNumber.trim() || undefined,
        answers,
        assignedSalesId: assignedSalesId || undefined,
        assignedServiceId: assignedServiceId || undefined
      });
      navigate(`/tickets/${res.data.id}`);
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Could not create the ticket.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="After-sales"
        title="New ticket"
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

      <form onSubmit={submit} className="space-y-6">
        <Section title="Customer">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Customer company">
              <LookupInput kind="customer" value={customerCompany} onChange={setCustomerCompany} maxLength={200} placeholder="Type to search existing customers" />
            </Field>
            <Field label="Production order no.">
              <LookupInput
                kind="order"
                value={orderNo}
                onChange={(v) => {
                  setOrderNo(v);
                  setPiId(null);
                }}
                onPick={applyPi}
                maxLength={100}
                placeholder="Type part of the order, PI no. or customer"
              />
            </Field>
            {piSerials.length > 0 && (
              <Field label="Device SN (optional)">
                <select className="font-mono" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)}>
                  <option value="">Not specified</option>
                  {piSerials.map((sn) => (
                    <option key={sn} value={sn}>{sn}</option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Contact name *">
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={200} required />
            </Field>
            <Field label="Contact details (email or phone) *">
              <input value={contactInfo} onChange={(e) => setContactInfo(e.target.value)} maxLength={200} required />
            </Field>
          </div>
        </Section>

        <Section title="Request details">
          <div className="space-y-4">
            {lineOptions.length > 0 ? (
              <Field label="Product * (lines of the approved PI)">
                <select value={lineKey} required onChange={(e) => setLineKey(e.target.value)}>
                  <option value="">Select the PI line this issue is about…</option>
                  {lineOptions.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label="Product *">
                <select value={productId} required onChange={(e) => setProductId(e.target.value)}>
                  <option value="">Select a product…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {ticketProductOptionLabel(p)}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {fields.map((field) => (
              <Field key={field.id} label={`${field.label}${field.required ? " *" : ""}`}>
                {field.fieldType === "DROPDOWN" ? (
                  <select
                    value={answers[field.id!] ?? ""}
                    required={Boolean(field.required)}
                    onChange={(e) => setAnswers((s) => ({ ...s, [field.id!]: e.target.value }))}
                  >
                    <option value="">Select…</option>
                    {(field.options ?? []).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <textarea
                    rows={3}
                    value={answers[field.id!] ?? ""}
                    required={Boolean(field.required)}
                    maxLength={2000}
                    onChange={(e) => setAnswers((s) => ({ ...s, [field.id!]: e.target.value }))}
                  />
                )}
              </Field>
            ))}
          </div>
        </Section>

        <Section title="Assignees">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Sales">
              <select value={assignedSalesId} onChange={(e) => setAssignedSalesId(e.target.value)}>
                <option value="">Unassigned</option>
                {salesUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName} ({u.role})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Service">
              <select value={assignedServiceId} onChange={(e) => setAssignedServiceId(e.target.value)}>
                <option value="">Unassigned</option>
                {serviceUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName} ({u.role})
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Section>

        <ErrorText message={error} />
        <div className="flex justify-end">
          <button className="btn-primary" disabled={submitting || !canSubmit}>
            {submitting ? "Creating…" : "Create ticket"}
          </button>
        </div>
      </form>
    </div>
  );
}
