import { useState } from "react";

export function OptionSetModal({
  title,
  options,
  onClose,
  onSave
}: {
  title: string;
  options: string[];
  onClose: () => void;
  onSave: (options: string[]) => void;
}) {
  const [rows, setRows] = useState<string[]>(options.length ? options : [""]);
  const cleaned = rows.map((row) => row.trim()).filter(Boolean);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/30 px-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="flex gap-2">
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
          <button type="button" className="btn-secondary" onClick={() => setRows([...rows, ""])}>
            Add Option
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => onSave(Array.from(new Set(cleaned)))}
          >
            Save Options
          </button>
        </div>
      </div>
    </div>
  );
}
