import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, LifeBuoy } from "lucide-react";
import { api } from "../api/client";
import { Turnstile, turnstileConfigured } from "../tickets/Turnstile";
import type { PublicProduct, TicketField } from "../types";

type FormConfig = {
  customerCompany: string;
  orderNo: string;
  fields: TicketField[];
};

function parseFields(raw: any[]): TicketField[] {
  return raw.map((f) => ({ ...f, options: JSON.parse(f.options || "[]") }));
}

export function PublicTicketForm() {
  const [params] = useSearchParams();
  const token = params.get("t") ?? "";

  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<FormConfig | null>(null);
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [loadError, setLoadError] = useState("");

  const [contactName, setContactName] = useState("");
  const [contactInfo, setContactInfo] = useState("");
  const [productId, setProductId] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [turnstileToken, setTurnstileToken] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [ticketNo, setTicketNo] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      if (!token) {
        setLoadError("This link is missing its access token.");
        setLoading(false);
        return;
      }
      try {
        const [form, prods] = await Promise.all([
          api.get(`/public/ticket-form?t=${encodeURIComponent(token)}`),
          api.get("/public/products")
        ]);
        if (!active) return;
        setConfig({ ...form.data, fields: parseFields(form.data.fields) });
        setProducts(prods.data);
      } catch (err: any) {
        if (active) setLoadError(err.response?.data?.error ?? "This link is invalid or has expired.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  const canSubmit = useMemo(() => {
    if (!contactName.trim() || !contactInfo.trim()) return false;
    if (!productId) return false; // product is required (需求 #1)
    if (turnstileConfigured && !turnstileToken) return false;
    return true;
  }, [contactName, contactInfo, productId, turnstileToken]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await api.post("/public/tickets", {
        token,
        contactName: contactName.trim(),
        contactInfo: contactInfo.trim(),
        productId,
        answers,
        turnstileToken
      });
      setTicketNo(res.data.ticketNo);
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div lang="en" className="min-h-screen bg-gradient-to-br from-[#f4f8ff] via-white to-[#e9f0ff] px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-[#3b7be8] to-[#0b4aa5] text-white shadow-lg shadow-blue-900/20">
            <LifeBuoy size={24} strokeWidth={1.9} />
          </span>
          <div>
            <div className="text-lg font-semibold tracking-tight text-[#07183f]">After-Sales Support</div>
            <div className="text-sm text-[#63749b]">Submit a service request</div>
          </div>
        </div>

        {loading ? (
          <div className="rounded-lg border border-[#dbe6fb] bg-white p-8 text-center text-sm text-[#63749b] shadow-sm">
            Loading…
          </div>
        ) : loadError ? (
          <div className="rounded-lg border border-red-100 bg-white p-8 text-center shadow-sm">
            <div className="text-base font-semibold text-red-600">Unable to open this form</div>
            <div className="mt-2 text-sm text-[#63749b]">{loadError}</div>
          </div>
        ) : ticketNo ? (
          <div className="rounded-lg border border-green-100 bg-white p-10 text-center shadow-sm">
            <CheckCircle2 size={48} className="mx-auto text-green-500" />
            <div className="mt-4 text-xl font-semibold text-[#07183f]">Request received</div>
            <div className="mt-2 text-sm text-[#63749b]">
              Your ticket has been created. Please keep this number for reference:
            </div>
            <div className="mt-4 inline-block rounded-lg bg-[#f1f5ff] px-5 py-2 text-lg font-semibold tracking-wide text-primary">
              {ticketNo}
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5 rounded-lg border border-[#dbe6fb] bg-white p-6 shadow-sm">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <ReadonlyField label="Company" value={config?.customerCompany || "—"} />
              <ReadonlyField label="Order No." value={config?.orderNo || "—"} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium text-[#294477]">
                <span>Contact name *</span>
                <input value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={200} required />
              </label>
              <label className="grid gap-1.5 text-sm font-medium text-[#294477]">
                <span>Contact details (email or phone) *</span>
                <input value={contactInfo} onChange={(e) => setContactInfo(e.target.value)} maxLength={200} required />
              </label>
            </div>

            <div className="border-t border-[#edf2fb] pt-5">
              <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[#8595b6]">Request details</h2>
            </div>

            <label className="grid gap-1.5 text-sm font-medium text-[#294477]">
              <span>Product *</span>
              <select value={productId} required onChange={(e) => setProductId(e.target.value)}>
                <option value="">Select a product…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nameEn}
                    {p.nameZh ? ` / ${p.nameZh}` : ""}
                  </option>
                ))}
              </select>
            </label>

            {config?.fields.map((field) => (
              <label key={field.id} className="grid gap-1.5 text-sm font-medium text-[#294477]">
                <span>
                  {field.label}
                  {field.required ? " *" : ""}
                </span>
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
              </label>
            ))}

            {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

            <Turnstile onToken={setTurnstileToken} />

            <button type="submit" className="btn-primary w-full" disabled={!canSubmit || submitting}>
              {submitting ? "Submitting…" : "Submit request"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1.5 text-sm font-medium text-[#294477]">
      <span>{label}</span>
      <div className="rounded-lg border border-[#e1e9f8] bg-[#f8fbff] px-3 py-2 text-[#07183f]">{value}</div>
    </div>
  );
}
