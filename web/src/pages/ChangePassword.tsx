import { FormEvent, useState } from "react";
import { KeyRound } from "lucide-react";
import { api } from "../api/client";
import { ErrorText, Field, PageHero, Section } from "../components/Form";

export function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setDone(false);
    if (newPassword !== confirm) { setError("New passwords do not match"); return; }
    try {
      await api.post("/auth/change-password", { currentPassword, newPassword });
      setDone(true);
      setCurrentPassword(""); setNewPassword(""); setConfirm("");
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Could not change password");
    }
  }

  return <div className="space-y-6">
    <PageHero
      eyebrow="Account"
      title="Change Password"
      Icon={KeyRound}
    />
    <Section title="New Password">
      <form onSubmit={submit} className="grid max-w-md gap-3">
        <Field label="Current Password"><input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required /></Field>
        <Field label="New Password"><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required /></Field>
        <Field label="Confirm New Password"><input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></Field>
        <p className="text-xs text-[#63749b]">At least 8 characters, including a letter and a number.</p>
        <ErrorText message={error} />
        {done && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Password updated.</div>}
        <button className="btn-primary w-fit">Update Password</button>
      </form>
    </Section>
  </div>;
}
