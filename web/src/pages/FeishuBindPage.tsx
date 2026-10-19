import { useState } from "react";
import { Link2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ErrorText, PageHero, Section } from "../components/Form";

// Opened from the Feishu bot's private "Link your Feishu account" card: ties
// that Feishu account to the portal user who is signed in here, so their card
// actions in Feishu count as them.
export function FeishuBindPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function bind() {
    setError("");
    setBusy(true);
    try {
      await api.post("/feishu/bind", { token });
      setDone(true);
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Could not link the account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHero eyebrow="Feishu" title="Link your Feishu account" Icon={Link2} />
      <Section title="Account link">
        {done ? (
          <p className="text-sm text-green-700">Linked. Go back to Feishu and press the button on the card again.</p>
        ) : !token ? (
          <p className="text-sm text-[#63749b]">This link is missing its code. Press a button on a bot card in Feishu to get a new link.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-[#294477]">
              Card actions you take in Feishu will be recorded as <strong>{user?.displayName}</strong> ({user?.role}). If this is not you, sign out first.
            </p>
            <ErrorText message={error} />
            <button type="button" className="btn-primary" disabled={busy} onClick={bind}>
              {busy ? "Linking…" : "Link this Feishu account"}
            </button>
          </div>
        )}
      </Section>
    </div>
  );
}
