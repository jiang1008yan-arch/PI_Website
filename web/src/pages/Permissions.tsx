import { FormEvent, useEffect, useState } from "react";
import { UsersRound } from "lucide-react";
import { api } from "../api/client";
import { EmptyState, ErrorText, Field, PageHero, Section } from "../components/Form";
import type { User } from "../types";

export function PermissionsPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ username: "", password: "Sales@123", displayName: "", role: "USER" });
  const load = () => api.get("/users").then((r) => setUsers(r.data));
  useEffect(() => { load(); }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.post("/users", form);
      setForm({ username: "", password: "Sales@123", displayName: "", role: "USER" });
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

  return <div className="space-y-6">
    <PageHero
      eyebrow="Admin access"
      title="Permission Management"
      description="Invite teammates with the right role so sales work can move from drafting to review without handoffs getting lost."
      Icon={UsersRound}
    />
    <Section title="Add User">
      <form onSubmit={add} className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Field label="Username"><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></Field>
        <Field label="Display Name"><input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
        <Field label="Password"><input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></Field>
        <Field label="Role"><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option>USER</option><option>ADMIN</option></select></Field>
        <button className="btn-primary mt-6">Add</button>
      </form>
      <ErrorText message={error} />
    </Section>
    <Section title="Users">
      {users.length === 0 ? (
        <EmptyState title="No users yet" description="Add a teammate above to start assigning review and admin responsibilities." />
      ) : (
        <table className="w-full text-sm"><thead><tr className="text-left text-slate-500"><th>Username</th><th>Name</th><th>Role</th><th></th></tr></thead><tbody>
          {users.map((u) => <tr key={u.id} className="border-t"><td className="py-3 font-medium text-[#07183f]">{u.username}</td><td>{u.displayName}</td><td><select value={u.role} onChange={(e) => patch(u.id, e.target.value)}><option>USER</option><option>ADMIN</option></select></td><td className="text-right"><button className="btn-danger" onClick={() => remove(u.id)}>Delete</button></td></tr>)}
        </tbody></table>
      )}
    </Section>
  </div>;
}
