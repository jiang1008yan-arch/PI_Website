import { Field } from "../components/Form";
import type { PiItem } from "../types";
import {
  buildGeneratedModel,
  getModelPrefix,
  getSegmentValue,
  ModelRule,
  setModelPrefix,
  setSegmentValue
} from "./modelRule";

export function ModelBuilder({
  rule,
  item,
  locked,
  generated,
  onChange
}: {
  rule: ModelRule;
  item: PiItem;
  locked: boolean;
  generated: ReturnType<typeof buildGeneratedModel>;
  onChange: (it: PiItem) => void;
}) {
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2">
        <Field label="Prefix">
          <select
            disabled={locked}
            value={getModelPrefix(item, rule)}
            onChange={(e) => onChange(setModelPrefix(item, e.target.value))}
          >
            <option value="">Select...</option>
            {rule.prefixOptions.map((option) => (
              <option key={option.code} value={option.code}>
                {option.description ? `${option.code} - ${option.description}` : option.code}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {rule.segments.map((segment) => (
          <Field key={segment.id} label={segment.label}>
            <select
              disabled={locked}
              value={getSegmentValue(item, segment)}
              onChange={(e) => onChange(setSegmentValue(item, segment, e.target.value))}
            >
              <option value="">Select...</option>
              {segment.options.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.code} - {option.description}
                </option>
              ))}
            </select>
          </Field>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Model">
          <div className="rounded-lg bg-white px-3 py-2 text-sm">{generated.model}</div>
        </Field>
      </div>
    </div>
  );
}
