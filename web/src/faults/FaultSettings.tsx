import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState, Field, Section } from "../components/Form";
import { OptionSetModal } from "../pi/OptionSetModal";

// The fault type list after-sales confirm tickets against, and (ADMIN only) when
// the same fault on the same product counts as a repeat fault.
export function FaultSettings() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [faultTypes, setFaultTypes] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [days, setDays] = useState("90");
  const [threshold, setThreshold] = useState("3");
  const [message, setMessage] = useState("");

  async function load() {
    const [types, d, t] = await Promise.all([
      api.get("/options/faultType"),
      api.get("/options/repeatFaultDays"),
      api.get("/options/repeatFaultThreshold")
    ]);
    setFaultTypes(types.data.map((r: any) => r.value));
    setDays(d.data[0]?.value ?? "90");
    setThreshold(t.data[0]?.value ?? "3");
  }
  useEffect(() => { void load(); }, []);

  async function saveTypes(values: string[]) {
    await api.put("/options/faultType", { values });
    setEditing(false);
    await load();
  }

  async function saveRepeat() {
    const valid = (v: string) => /^\d+$/.test(v) && Number(v) > 0;
    if (!valid(days) || !valid(threshold)) {
      setMessage("Use whole numbers above zero.");
      return;
    }
    await Promise.all([
      api.put("/options/repeatFaultDays", { values: [days] }),
      api.put("/options/repeatFaultThreshold", { values: [threshold] })
    ]);
    setMessage("Saved.");
  }

  return (
    <Section title="Fault types & repeat faults" action={<button type="button" className="btn-secondary" onClick={() => setEditing(true)}>Edit fault types</button>}>
      {faultTypes.length === 0 ? (
        <EmptyState title="No fault types yet" description="Add the fault types after-sales choose from when confirming a ticket." />
      ) : (
        <div className="flex flex-wrap gap-2">
          {faultTypes.map((f) => <span key={f} className="rounded-full bg-[#f1f5fc] px-3 py-1 text-sm text-[#294477]">{f}</span>)}
        </div>
      )}
      <div className="mt-4 grid grid-cols-1 items-end gap-3 border-t pt-4 sm:grid-cols-[1fr_1fr_auto]">
        <Field label="Look-back window (days)">
          <input value={days} onChange={(e) => setDays(e.target.value)} disabled={!isAdmin} inputMode="numeric" />
        </Field>
        <Field label="Repeat when the same fault reaches">
          <input value={threshold} onChange={(e) => setThreshold(e.target.value)} disabled={!isAdmin} inputMode="numeric" />
        </Field>
        {isAdmin && <button type="button" className="btn-primary" onClick={saveRepeat}>Save</button>}
      </div>
      {!isAdmin && <p className="mt-2 text-xs text-[#8595b6]">Only an admin can change the repeat-fault settings.</p>}
      {message && <p className="mt-2 text-sm text-[#294477]">{message}</p>}
      {editing && <OptionSetModal title="Fault types" options={faultTypes} onClose={() => setEditing(false)} onSave={saveTypes} />}
    </Section>
  );
}
