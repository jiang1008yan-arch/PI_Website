import { useState } from "react";
import { Field } from "../components/Form";
import { optionSummary } from "../products/productFields";
import { OptionsModal } from "../products/OptionsModal";
import type { TicketField } from "../types";

function sameField(a: TicketField, b: TicketField) {
  const opts = (o?: string[]) => JSON.stringify((o ?? []).map((x) => String(x).trim()).filter(Boolean));
  return (
    String(a.label ?? "").trim() === String(b.label ?? "").trim() &&
    (a.fieldType === "DROPDOWN" ? "DROPDOWN" : "TEXT") === (b.fieldType === "DROPDOWN" ? "DROPDOWN" : "TEXT") &&
    opts(a.options) === opts(b.options) &&
    Boolean(a.required) === Boolean(b.required)
  );
}

export function TicketFieldRow({
  field,
  onSave,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown
}: {
  field: TicketField;
  onSave: (f: TicketField) => void;
  onDelete?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  const [draft, setDraft] = useState<TicketField>({ ...field, options: field.options ?? [] });
  const [optionsOpen, setOptionsOpen] = useState(false);
  const dirty = !sameField(draft, field);
  const canCommit = dirty && String(draft.label ?? "").trim();
  const isText = draft.fieldType === "TEXT";

  return (
    <div className="space-y-3 rounded-lg bg-slate-50 p-3">
      <div className="grid grid-cols-[1.2fr_140px_1fr_120px_auto] gap-3">
        <Field label="Question label">
          <input
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="Describe the issue"
          />
        </Field>
        <Field label="Type">
          <select
            value={draft.fieldType}
            onChange={(e) =>
              setDraft({
                ...draft,
                fieldType: e.target.value as TicketField["fieldType"],
                options: e.target.value === "DROPDOWN" ? draft.options : []
              })
            }
          >
            <option value="TEXT">Text</option>
            <option value="DROPDOWN">Dropdown</option>
          </select>
        </Field>
        {isText ? (
          <Field label="Answer">
            <div className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-400">
              Free text
            </div>
          </Field>
        ) : (
          <Field label="Options">
            <button type="button" className="btn-secondary text-left" onClick={() => setOptionsOpen(true)}>
              {optionSummary(draft.options ?? [], "")}
            </button>
          </Field>
        )}
        <Field label="Required">
          <label className="flex h-[42px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm">
            <input
              type="checkbox"
              checked={Boolean(draft.required)}
              onChange={(e) => setDraft({ ...draft, required: e.target.checked ? 1 : 0 })}
            />
            Required
          </label>
        </Field>
        <div className="mt-6 flex gap-2">
          {onMoveUp && (
            <button type="button" className="btn-secondary" disabled={!canMoveUp} onClick={onMoveUp}>
              Up
            </button>
          )}
          {onMoveDown && (
            <button type="button" className="btn-secondary" disabled={!canMoveDown} onClick={onMoveDown}>
              Down
            </button>
          )}
        </div>
      </div>
      <div className="flex min-w-[150px] gap-2">
        {dirty && (
          <button type="button" className="btn-primary" disabled={!canCommit} onClick={() => onSave(draft)}>
            {field.id ? "Save" : "Add"}
          </button>
        )}
        {field.id && onDelete && (
          <button type="button" className="btn-danger" onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
      {optionsOpen && (
        <OptionsModal
          options={draft.options ?? []}
          defaultValue=""
          onClose={() => setOptionsOpen(false)}
          onSave={(options) => {
            setDraft({ ...draft, options });
            setOptionsOpen(false);
          }}
        />
      )}
    </div>
  );
}
