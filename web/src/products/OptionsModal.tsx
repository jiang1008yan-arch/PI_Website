import { useId, useState } from "react";

export function OptionsModal({
  options,
  defaultValue,
  onClose,
  onSave
}: {
  options: string[];
  defaultValue: string;
  onClose: () => void;
  onSave: (options: string[], defaultValue: string) => void;
}) {
  const [rows, setRows] = useState<string[]>(options.length ? options : [""]);
  const [selectedDefault, setSelectedDefault] = useState(defaultValue);
  const defaultGroupName = useId();
  const cleaned = rows.map((row) => row.trim()).filter(Boolean);

  return (
    <div className="relative z-10 rounded-lg border border-[#dbe6fb] bg-white p-4 shadow-[0_18px_42px_rgba(8,36,107,0.12)]">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Dropdown Options</h3>
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
        {rows.map((row, index) => (
          <div key={index} className="grid grid-cols-[120px_minmax(0,1fr)_86px] gap-2">
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm">
              <input
                type="radio"
                name={defaultGroupName}
                checked={selectedDefault === row.trim() && row.trim() !== ""}
                onChange={() => setSelectedDefault(row.trim())}
                disabled={!row.trim()}
              />
              Default
            </label>
            <input
              value={row}
              onChange={(e) => setRows(rows.map((item, i) => (i === index ? e.target.value : item)))}
              placeholder={`Option ${index + 1}`}
            />
            <button
              type="button"
              className="btn-danger"
              onClick={() => setRows(rows.filter((_, i) => i !== index))}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => setRows([...rows, ""])}>
            Add Option
          </button>
          <button type="button" className="btn-secondary" onClick={() => setSelectedDefault("")}>
            No Default
          </button>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            const unique = Array.from(new Set(cleaned));
            onSave(unique, unique.includes(selectedDefault) ? selectedDefault : "");
          }}
        >
          Save Options
        </button>
      </div>
    </div>
  );
}
