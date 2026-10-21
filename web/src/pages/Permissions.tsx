import { FormEvent, useEffect, useState } from "react";
import { UsersRound } from "lucide-react";
import { api } from "../api/client";
import { EmptyState, ErrorText, Field, PageHero, Section } from "../components/Form";
import type { Role, User } from "../types";

const ROLES: Role[] = ["SALES", "PRESALES", "COMMERCE", "SERVICE", "ADMIN"];

type FeishuLinkResult = { status: string; message: string } | null;
// One inline edit at a time (no browser pop-ups: in-app and Feishu browsers block them).
type Editing = { userId: string; kind: "mobile" | "password" | "unlink"; value: string } | null;

export function PermissionsPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState("");
  // The outcome of the last Feishu link attempt (from a mobile number).
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const [form, setForm] = useState({ username: "", password: "Sales@123", displayName: "", role: "SALES", mobile: "" });
  const load = () => api.get("/users").then((r) => setUsers(r.data));
  useEffect(() => { load(); }, []);

  const report = (who: string, feishu: FeishuLinkResult) => setNotice(feishu ? `${who}: ${feishu.message}` : "");

  async function add(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const res = await api.post("/users", form);
      report(form.displayName || form.username, res.data.feishu);
      setForm({ username: "", password: "Sales@123", displayName: "", role: "SALES", mobile: "" });
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Could not add user");
    }
  }

  async function patch(id: string, role: string) {
    try { await api.patch(`/users/${id}`, { role }); await load(); } catch (err: any) { setError(err.response?.data?.error ?? "Update failed"); }
  }

  async function remove(id: string) {
    try { await api.delete(`/users/${id}`); await load(); } catch (err: any) { setError(err.response?.data?.error ?? "Delete failed"); }
  }

  async function resetPassword(u: User, password: string) {
    setError("");
    try {
      await api.post(`/users/${u.id}/reset-password`, { newPassword: password });
      setEditing(null);
      setNotice(`${u.displayName}: password reset.`);
    } catch (err: any) { setError(err.response?.data?.error ?? "Reset failed"); }
  }

  async function saveMobile(u: User, mobile: string) {
    setError("");
    try {
      const res = await api.patch(`/users/${u.id}`, { mobile });
      setEditing(null);
      if (res.data.feishu) report(u.displayName, res.data.feishu);
      else setNotice(`${u.displayName}: mobile number ${mobile.trim() ? "saved" : "cleared"}.`);
      await load();
    } catch (err: any) { setError(err.response?.data?.error ?? "Update failed"); }
  }

  async function relink(u: User) {
    setError("");
    try { const res = await api.post(`/users/${u.id}/feishu-link`); report(u.displayName, res.data.feishu); await load(); }
    catch (err: any) { setError(err.response?.data?.error ?? "Link failed"); }
  }

  async function unlink(u: User) {
    setError("");
    try { await api.delete(`/users/${u.id}/feishu-link`); setEditing(null); setNotice(`${u.displayName}: Feishu unlinked; they get no bot messages until linked again.`); await load(); }
    catch (err: any) { setError(err.response?.data?.error ?? "Unlink failed"); }
  }

  return <div className="space-y-6">
    <PageHero
      eyebrow="Admin access"
      title="Permission Management"
      description="A person's role here decides what they can do on the website and in both Feishu bots. Add their Feishu mobile number to link their Feishu account automatically."
      Icon={UsersRound}
    />
    <Section title="Add User">
      <form onSubmit={add} className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Field label="Username"><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></Field>
        <Field label="Display Name"><input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
        <Field label="Password"><input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></Field>
        <Field label="Role"><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Feishu mobile"><input value={form.mobile} placeholder="Optional" onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></Field>
        <button className="btn-primary mt-6">Add</button>
      </form>
      <ErrorText message={error} />
      {notice && <p className="mt-3 text-sm text-[#405079]">{notice}</p>}
    </Section>
    <Section title="Users">
      {users.length === 0 ? (
        <EmptyState title="No users yet" description="Add a teammate above to start assigning review and admin responsibilities." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm"><thead><tr className="text-left text-slate-500"><th>Username</th><th>Name</th><th>Role</th><th>Feishu</th><th></th></tr></thead><tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="py-3 font-medium text-[#07183f]">{u.username}</td>
                <td>{u.displayName}</td>
                <td><select value={u.role} onChange={(e) => patch(u.id, e.target.value)}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></td>
                <td className="py-2">
                  {editing?.userId === u.id && editing.kind === "mobile" ? (
                    <InlineInput
                      value={editing.value}
                      placeholder="Feishu mobile (empty to clear)"
                      onChange={(value) => setEditing({ ...editing, value })}
                      onSave={() => saveMobile(u, editing.value)}
                      onCancel={() => setEditing(null)}
                    />
                  ) : editing?.userId === u.id && editing.kind === "unlink" ? (
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-[#405079]">Unlink Feishu?</span>
                      <button type="button" className="font-semibold text-red-600 hover:underline" onClick={() => unlink(u)}>Confirm unlink</button>
                      <button type="button" className="text-[#617295] hover:underline" onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${u.feishuLinked ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                        {u.feishuLinked ? "Linked" : "Not linked"}
                      </span>
                      <button type="button" className="text-xs text-primary hover:underline" title="Edit the Feishu mobile number" onClick={() => setEditing({ userId: u.id, kind: "mobile", value: u.mobile ?? "" })}>
                        {u.mobile ? u.mobile : "Add mobile"}
                      </button>
                      {!u.feishuLinked && u.mobile && <button type="button" className="text-xs text-primary hover:underline" onClick={() => relink(u)}>Try again</button>}
                      {Boolean(u.feishuLinked) && <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setEditing({ userId: u.id, kind: "unlink", value: "" })}>Unlink</button>}
                    </div>
                  )}
                </td>
                <td className="whitespace-nowrap text-right">
                  {editing?.userId === u.id && editing.kind === "password" ? (
                    <InlineInput
                      value={editing.value}
                      placeholder="New password"
                      onChange={(value) => setEditing({ ...editing, value })}
                      onSave={() => resetPassword(u, editing.value)}
                      onCancel={() => setEditing(null)}
                    />
                  ) : (
                    <span className="space-x-2">
                      <button className="btn-secondary" onClick={() => setEditing({ userId: u.id, kind: "password", value: "" })}>Reset Password</button>
                      <button className="btn-danger" onClick={() => remove(u.id)}>Delete</button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
    </Section>
  </div>;
}

// A small input with Save / Cancel; Enter saves, Esc cancels.
function InlineInput({ value, placeholder, onChange, onSave, onCancel }: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <input
        autoFocus
        value={value}
        placeholder={placeholder}
        className="w-48 rounded border border-[#d5def0] px-2 py-1 text-sm"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave();
          if (e.key === "Escape") onCancel();
        }}
      />
      <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={onSave}>Save</button>
      <button type="button" className="text-xs text-[#617295] hover:underline" onClick={onCancel}>Cancel</button>
    </div>
  );
}
