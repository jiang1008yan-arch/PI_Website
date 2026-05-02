import { Field } from "../components/Form";

export function SelectWithManage({
  label,
  value,
  options,
  disabled,
  canManage,
  onChange,
  onManage
}: {
  label: string;
  value: string;
  options: string[];
  disabled: boolean;
  canManage: boolean;
  onChange: (value: string) => void;
  onManage: () => void;
}) {
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <select
          className="min-w-0 flex-1"
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select...</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {canManage && (
          <button type="button" className="btn-secondary" onClick={onManage}>
            Manage
          </button>
        )}
      </div>
    </Field>
  );
}
