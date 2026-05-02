import { Field } from "../components/Form";
import type { Language } from "../types";
import { ModelOption, ModelRule, ModelSegment } from "../pi/modelRule";
import { formatModelOptions, parseModelOptions } from "./modelRuleAdmin";

export function ModelRuleEditor({
  disabled,
  language,
  rule,
  onChange
}: {
  disabled: boolean;
  language: Language;
  rule: ModelRule;
  onChange: (rule: ModelRule) => void;
}) {
  const addSegment = () =>
    onChange({
      ...rule,
      segments: [...rule.segments, { id: crypto.randomUUID(), label: "", options: [] }]
    });
  const updateSegment = (id: string, next: Partial<ModelSegment>) =>
    onChange({
      ...rule,
      segments: rule.segments.map((segment) => (segment.id === id ? { ...segment, ...next } : segment))
    });
  const deleteSegment = (id: string) =>
    onChange({ ...rule, segments: rule.segments.filter((segment) => segment.id !== id) });
  const addPrefixOption = () =>
    onChange({ ...rule, prefixOptions: [...rule.prefixOptions, { code: "", description: "" }] });
  const updatePrefixOption = (index: number, next: ModelOption) =>
    onChange({
      ...rule,
      prefixOptions: rule.prefixOptions.map((option, optionIndex) =>
        optionIndex === index ? next : option
      )
    });
  const deletePrefixOption = (index: number) =>
    onChange({
      ...rule,
      prefixOptions: rule.prefixOptions.filter((_, optionIndex) => optionIndex !== index)
    });

  return (
    <div className="border-t pt-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={rule.enabled}
            disabled={disabled}
            onChange={(e) => onChange({ ...rule, enabled: e.target.checked })}
          />
          Model Builder ({language})
        </label>
        <span className="text-sm text-slate-500">Saved with Save Product</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Separator">
          <input
            disabled={disabled || !rule.enabled}
            value={rule.separator}
            placeholder="-"
            onChange={(e) => onChange({ ...rule, separator: e.target.value })}
          />
        </Field>
        <div className="mt-6">
          <button
            type="button"
            className="btn-secondary"
            disabled={disabled || !rule.enabled}
            onClick={addSegment}
          >
            Add Segment
          </button>
        </div>
      </div>
      <div className="mt-3 rounded-lg bg-slate-50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-medium">Prefix Options</div>
          <button
            type="button"
            className="btn-secondary"
            disabled={disabled || !rule.enabled}
            onClick={addPrefixOption}
          >
            Add Prefix
          </button>
        </div>
        <div className="space-y-2">
          {rule.prefixOptions.map((option, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <input
                disabled={disabled || !rule.enabled}
                value={option.code}
                placeholder="iM3W-11K0P"
                onChange={(e) => updatePrefixOption(index, { ...option, code: e.target.value })}
              />
              <input
                disabled={disabled || !rule.enabled}
                value={option.description}
                placeholder="Description"
                onChange={(e) => updatePrefixOption(index, { ...option, description: e.target.value })}
              />
              <button
                type="button"
                className="btn-danger"
                disabled={disabled || !rule.enabled}
                onClick={() => deletePrefixOption(index)}
              >
                Delete
              </button>
            </div>
          ))}
          {rule.prefixOptions.length === 0 && (
            <div className="text-sm text-slate-500">Add at least one prefix option.</div>
          )}
        </div>
      </div>
      <div className="mt-3 space-y-3">
        {rule.segments.map((segment, index) => (
          <div key={segment.id} className="grid grid-cols-[220px_1fr_auto] gap-3 rounded-lg bg-slate-50 p-3">
            <Field label={`Segment ${index + 1} label`}>
              <input
                disabled={disabled || !rule.enabled}
                value={segment.label}
                placeholder="Cable length"
                onChange={(e) => updateSegment(segment.id, { label: e.target.value })}
              />
            </Field>
            <Field label="Options">
              <textarea
                className="w-full"
                disabled={disabled || !rule.enabled}
                rows={4}
                value={formatModelOptions(segment.options)}
                placeholder={"0 = Case B\n5 = 5m cable"}
                onChange={(e) => updateSegment(segment.id, { options: parseModelOptions(e.target.value) })}
              />
            </Field>
            <button
              type="button"
              className="btn-danger mt-6 self-start"
              disabled={disabled || !rule.enabled}
              onClick={() => deleteSegment(segment.id)}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
      {!disabled && !rule.enabled && (
        <p className="mt-2 text-sm text-slate-500">Enable this only for products that need generated order codes.</p>
      )}
      {disabled && (
        <p className="mt-2 text-sm text-slate-500">Save the product before setting a model builder.</p>
      )}
    </div>
  );
}
