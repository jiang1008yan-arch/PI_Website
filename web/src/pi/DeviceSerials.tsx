import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useConfirm } from "../components/ConfirmDialog";
import { EmptyState, Section } from "../components/Form";

type Device = { id: string; serialNumber: string; createdAt: string; createdByName?: string | null };
type RegisterResult = {
  added: string[];
  duplicates: { serialNumber: string; piNo: string; samePi: boolean }[];
  invalid: string[];
};

// Device serial numbers registered on an approved Chinese PI. After-sales and
// admins add them (one by one or pasted, one per line); everyone who can open
// the PI sees them. An SN belongs to one PI only — duplicates are reported.
export function DeviceSerials({ piId }: { piId: string }) {
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN" || user?.role === "SERVICE";
  const [devices, setDevices] = useState<Device[]>([]);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<RegisterResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();

  async function load() {
    const res = await api.get(`/pi/${piId}/devices`);
    setDevices(res.data);
  }
  useEffect(() => { void load().catch(() => setDevices([])); }, [piId]);

  async function register() {
    if (!input.trim()) return;
    setError("");
    setBusy(true);
    try {
      const res = await api.post(`/pi/${piId}/devices`, { serials: input });
      setResult(res.data);
      setInput("");
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message ?? "Could not register serial numbers.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(device: Device) {
    if (!(await confirm({ message: `Remove serial number ${device.serialNumber} from this PI?`, confirmLabel: "Remove", danger: true }))) return;
    await api.delete(`/pi/${piId}/devices/${device.id}`);
    await load();
  }

  return (
    <Section title={`Device serial numbers (${devices.length})`}>
      {devices.length === 0 ? (
        <EmptyState title="No serial numbers yet" description={canEdit ? "Add the SNs of the devices delivered under this PI." : "After-sales add SNs once devices are delivered."} />
      ) : (
        <div className="flex flex-wrap gap-2">
          {devices.map((d) => (
            <span key={d.id} className="inline-flex items-center gap-2 rounded-full border border-[#dbe6fb] bg-white px-3 py-1 font-mono text-sm text-[#07183f]" title={`Added ${d.createdAt}${d.createdByName ? ` by ${d.createdByName}` : ""}`}>
              {d.serialNumber}
              {canEdit && (
                <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => remove(d)} aria-label={`Remove ${d.serialNumber}`}>
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {canEdit && (
        <div className="mt-4 space-y-2 border-t pt-4">
          <textarea
            className="w-full font-mono"
            rows={3}
            placeholder={"One serial number per line, e.g.\nCHG-2026-0001\nCHG-2026-0002"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="button" className="btn-secondary" disabled={busy || !input.trim()} onClick={register}>
            {busy ? "Adding…" : "Add serial numbers"}
          </button>
          {result && (
            <div className="space-y-1 text-sm">
              {result.added.length > 0 && <div className="text-green-700">Added {result.added.length}: {result.added.join(", ")}</div>}
              {result.duplicates.length > 0 && (
                <div className="text-amber-700">
                  Already registered (not changed): {result.duplicates.map((d) => `${d.serialNumber}${d.samePi ? "" : ` on ${d.piNo}`}`).join(", ")}
                </div>
              )}
              {result.invalid.length > 0 && <div className="text-red-700">Not valid serial numbers: {result.invalid.join(", ")}</div>}
            </div>
          )}
          {error && <div className="text-sm text-red-700">{error}</div>}
        </div>
      )}
    </Section>
  );
}
