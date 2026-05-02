import { useState } from "react";

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
  const cleaned = rows.map((row) => row.trim()).filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/30 px-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Dropdown Options</h3>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="flex gap-2">
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm">
                <input
                  type="radio"
                  name="dropdownDefault"
                  checked={selectedDefault === row.trim() && row.trim() !== ""}
                  onChange={() => setSelectedDefault(row.trim())}
                  disabled={!row.trim()}
                />
                Default
              </label>
              <input
                className="flex-1"
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
        <div className="mt-4 flex justify-between">
          <div className="flex gap-2">
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
    </div>
  );
}
