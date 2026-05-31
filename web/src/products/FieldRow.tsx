import { useState } from "react";
import { Field } from "../components/Form";
import type { ProductField } from "../types";
import { optionSummary, sameField } from "./productFields";
import { OptionsModal } from "./OptionsModal";

export function FieldRow({
  field,
  onSave,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  enFields
}: {
  field: ProductField;
  onSave: (f: ProductField) => void;
  onDelete?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  enFields?: { id: string; label: string }[];
}) {
  const [draft, setDraft] = useState<any>({ ...field, options: field.options ?? [] });
  const [optionsOpen, setOptionsOpen] = useState(false);
  const dirty = !sameField(draft, field);
  const canCommit = dirty && String(draft.label ?? "").trim();
  const isText = draft.fieldType === "TEXT";

  return (
    <div className="space-y-3 rounded-lg bg-slate-50 p-3">
    <div className="grid grid-cols-[1.2fr_140px_1fr_170px_auto] gap-3">
      <Field label="Field label">
        <input
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          placeholder="Cable length"
        />
      </Field>
      <Field label="Type">
        <select
          value={draft.fieldType}
          onChange={(e) =>
            setDraft({
              ...draft,
              fieldType: e.target.value,
              options: e.target.value === "DROPDOWN" ? draft.options : [],
              defaultValue: ""
            })
          }
        >
          <option value="TEXT">Text</option>
          <option value="DROPDOWN">Dropdown</option>
        </select>
      </Field>
      {isText ? (
        <Field label="Default value">
          <input
            value={draft.defaultValue ?? ""}
            onChange={(e) => setDraft({ ...draft, defaultValue: e.target.value })}
          />
        </Field>
      ) : (
        <Field label="Options and default">
          <button type="button" className="btn-secondary text-left" onClick={() => setOptionsOpen(true)}>
            {optionSummary(draft.options ?? [], draft.defaultValue)}
          </button>
        </Field>
      )}
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
      <div className="mt-6 flex min-w-[150px] gap-2">
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
      </div>
      {enFields && (
        <Field label="Mapped English field (for EN→ZH generation)">
          <select
            value={draft.mapKey ?? ""}
            onChange={(e) => setDraft({ ...draft, mapKey: e.target.value || null })}
          >
            <option value="">None</option>
            {enFields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      {optionsOpen && (
        <OptionsModal
          options={draft.options ?? []}
          defaultValue={draft.defaultValue ?? ""}
          onClose={() => setOptionsOpen(false)}
          onSave={(options, defaultValue) => {
            setDraft({ ...draft, options, defaultValue });
            setOptionsOpen(false);
          }}
        />
      )}
    </div>
  );
}
