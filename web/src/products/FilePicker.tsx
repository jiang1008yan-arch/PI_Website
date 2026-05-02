import { useRef, useState } from "react";
import { Field } from "../components/Form";

export function FilePicker({
  label,
  disabled,
  accept = ".xlsx",
  onPick
}: {
  label: string;
  disabled?: boolean;
  accept?: string;
  onPick: (file?: File) => void | Promise<void>;
}) {
  const [name, setName] = useState("No file selected");
  const [status, setStatus] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function handlePick(file?: File) {
    if (!file) {
      setName("No file selected");
      setStatus("");
      return;
    }

    setName(file.name);
    setStatus("Uploading...");

    try {
      await onPick(file);
      setName("No file selected");
      setStatus("Upload complete.");
      if (inputRef.current) inputRef.current.value = "";
      setTimeout(() => setStatus(""), 2200);
    } catch {
      setStatus("Upload failed. Please try again.");
    }
  }

  return (
    <Field label={label}>
      <label
        className={`flex items-center justify-between gap-3 rounded-lg border border-[#d9e2f5] bg-white/95 px-3 py-2 text-sm text-[#07183f] shadow-sm ${
          disabled ? "opacity-50" : "cursor-pointer hover:bg-[#f8fbff]"
        }`}
      >
        <span className="min-w-0 truncate">{name}</span>
        <span className="shrink-0 rounded-md bg-[#f1f5ff] px-2 py-1 text-primary ring-1 ring-[#dfe7f7]">Choose File</span>
        <input
          ref={inputRef}
          className="hidden"
          type="file"
          accept={accept}
          disabled={disabled}
          onChange={(e) => void handlePick(e.target.files?.[0])}
        />
      </label>
      {status && (
        <span className={`text-xs ${status === "Upload complete." ? "text-primary" : status === "Uploading..." ? "text-[#63749b]" : "text-[#9f1239]"}`}>
          {status}
        </span>
      )}
    </Field>
  );
}
