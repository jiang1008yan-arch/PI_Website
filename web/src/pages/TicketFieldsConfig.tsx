import { useEffect, useState } from "react";
import { ChevronLeft, ClipboardList } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { EmptyState, ErrorText, PageHero, Section } from "../components/Form";
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
        description="Define the questions shown on the public after-sales form. Drag-free ordering with Up/Down; dropdown options become the customer's choices."
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
          The first dropdown question is used as the "problem type" axis on the ticket statistics page.
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
    </div>
  );
}
