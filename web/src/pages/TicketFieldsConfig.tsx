import { useEffect, useState } from "react";
import { ChevronLeft, ClipboardList } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState, ErrorText, Field, PageHero, Section } from "../components/Form";
import { OptionSetModal } from "../pi/OptionSetModal";
import { TicketFieldRow } from "../tickets/TicketFieldRow";
import type { TicketField } from "../types";

const blankField: TicketField = { label: "", fieldType: "TEXT", options: [], required: 0, sortOrder: 0 };

function parseField(f: any): TicketField {
  return { ...f, options: JSON.parse(f.options || "[]") };
}

function normalize(f: TicketField, sortOrder: number) {
  return {
    label: String(f.label ?? "").trim(),
    fieldType: f.fieldType === "DROPDOWN" ? "DROPDOWN" : "TEXT",
    options: f.fieldType === "DROPDOWN" ? (f.options ?? []).map((o) => String(o).trim()).filter(Boolean) : [],
    required: f.required ? 1 : 0,
    sortOrder
  };
}

export function TicketFieldsConfigPage() {
  const [fields, setFields] = useState<TicketField[]>([]);
  const [error, setError] = useState("");

  async function load() {
    const res = await api.get("/ticket-fields");
    setFields(res.data.map(parseField));
  }

  useEffect(() => {
    load();
  }, []);

  async function saveField(field: TicketField) {
    const label = String(field.label ?? "").trim();
    if (!label) {
      setError("Question label is required.");
      return;
    }
    setError("");
    if (field.id) {
      const idx = fields.findIndex((f) => f.id === field.id);
      await api.patch(`/ticket-fields/${field.id}`, normalize(field, idx < 0 ? field.sortOrder : idx));
    } else {
      await api.post("/ticket-fields", normalize(field, fields.length));
    }
    await load();
  }

  async function deleteField(field: TicketField) {
    if (!field.id) return;
    if (!window.confirm(`Delete "${field.label.trim() || "this question"}"? This cannot be undone.`)) return;
    await api.delete(`/ticket-fields/${field.id}`);
    await load();
  }

  async function move(index: number, direction: -1 | 1) {
    const next = index + direction;
    if (next < 0 || next >= fields.length) return;
    const reordered = [...fields];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(next, 0, moved);
    setFields(reordered);
    await Promise.all(
      reordered
        .filter((f) => f.id)
        .map((f, i) => api.patch(`/ticket-fields/${f.id}`, normalize(f, i)))
    );
    await load();
  }

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="After-Sales"
        title="Ticket Questionnaire"
        Icon={ClipboardList}
        action={
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-sm font-medium text-[#63749b] transition hover:text-primary hover:underline"
          >
            <ChevronLeft size={16} />
            Back
          </Link>
        }
      />
      <Section title="Questions">
        <ErrorText message={error} />
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          The first dropdown question is charted as the customer-reported problem type. Statistics on repeat faults use the
          fault type after-sales confirm on each ticket (below).
        </p>
        {fields.length === 0 && (
          <EmptyState title="No questions yet" description="Add your first question below to start collecting structured details." />
        )}
        <div className="space-y-3">
          {fields.map((field, index) => (
            <TicketFieldRow
              key={field.id}
              field={field}
              onSave={saveField}
              onDelete={() => deleteField(field)}
              onMoveUp={() => move(index, -1)}
              onMoveDown={() => move(index, 1)}
              canMoveUp={index > 0}
              canMoveDown={index < fields.length - 1}
            />
          ))}
          <TicketFieldRow key={`new-${fields.length}`} field={blankField} onSave={saveField} />
        </div>
      </Section>
      <FaultSettings />
    </div>
  );
}

// The fault type list after-sales confirm tickets against, and (ADMIN only) when
// the same fault on the same product counts as a repeat fault.
function FaultSettings() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [faultTypes, setFaultTypes] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [days, setDays] = useState("90");
  const [threshold, setThreshold] = useState("3");
  const [message, setMessage] = useState("");

  async function load() {
    const [types, d, t] = await Promise.all([
      api.get("/options/faultType"),
      api.get("/options/repeatFaultDays"),
      api.get("/options/repeatFaultThreshold")
    ]);
    setFaultTypes(types.data.map((r: any) => r.value));
    setDays(d.data[0]?.value ?? "90");
    setThreshold(t.data[0]?.value ?? "3");
  }
  useEffect(() => { void load(); }, []);

  async function saveTypes(values: string[]) {
    await api.put("/options/faultType", { values });
    setEditing(false);
    await load();
  }

  async function saveRepeat() {
    const valid = (v: string) => /^\d+$/.test(v) && Number(v) > 0;
    if (!valid(days) || !valid(threshold)) {
      setMessage("Use whole numbers above zero.");
      return;
    }
    await Promise.all([
      api.put("/options/repeatFaultDays", { values: [days] }),
      api.put("/options/repeatFaultThreshold", { values: [threshold] })
    ]);
    setMessage("Saved.");
  }

  return (
    <Section title="Fault types & repeat faults" action={<button type="button" className="btn-secondary" onClick={() => setEditing(true)}>Edit fault types</button>}>
      {faultTypes.length === 0 ? (
        <EmptyState title="No fault types yet" description="Add the fault types after-sales choose from when confirming a ticket." />
      ) : (
        <div className="flex flex-wrap gap-2">
          {faultTypes.map((f) => <span key={f} className="rounded-full bg-[#f1f5fc] px-3 py-1 text-sm text-[#294477]">{f}</span>)}
        </div>
      )}
      <div className="mt-4 grid grid-cols-1 items-end gap-3 border-t pt-4 sm:grid-cols-[1fr_1fr_auto]">
        <Field label="Look-back window (days)">
          <input value={days} onChange={(e) => setDays(e.target.value)} disabled={!isAdmin} inputMode="numeric" />
        </Field>
        <Field label="Repeat when the same fault reaches">
          <input value={threshold} onChange={(e) => setThreshold(e.target.value)} disabled={!isAdmin} inputMode="numeric" />
        </Field>
        {isAdmin && <button type="button" className="btn-primary" onClick={saveRepeat}>Save</button>}
      </div>
      {!isAdmin && <p className="mt-2 text-xs text-[#8595b6]">Only an admin can change the repeat-fault settings.</p>}
      {message && <p className="mt-2 text-sm text-[#294477]">{message}</p>}
      {editing && <OptionSetModal title="Fault types" options={faultTypes} onClose={() => setEditing(false)} onSave={saveTypes} />}
    </Section>
  );
}
