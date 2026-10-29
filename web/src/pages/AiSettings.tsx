import { FormEvent, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { api } from "../api/client";
import { ErrorText, Field, PageHero, Section } from "../components/Form";
import { useBotName } from "../hooks/useBotName";

type Provider = "QWEN" | "DEEPSEEK";
type AiState = {
  available: boolean;
  feishuLinked: boolean;
  providers: Record<Provider, { defaultModel: string }>;
  setting: { provider: Provider; model: string | null; maskedKey: string; updatedAt: string } | null;
};

const PROVIDER_LABEL: Record<Provider, string> = { QWEN: "Qwen (Alibaba Cloud Model Studio)", DEEPSEEK: "DeepSeek" };
const KEY_HELP: Record<Provider, string> = {
  QWEN: "Create a key in the Alibaba Cloud Model Studio (百炼) console → API-KEY.",
  DEEPSEEK: "Create a key on platform.deepseek.com → API keys."
};

// The signed-in user's own AI key. Optional: without one, the Feishu ticket
// form simply has no AI suggestion. The key is write-only — once saved it is
// only shown masked.
export function AiSettingsPage() {
  const bot = useBotName();
  const [state, setState] = useState<AiState | null>(null);
  const [provider, setProvider] = useState<Provider | "OFF">("OFF");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const res = await api.get("/me/ai");
    setState(res.data);
    setProvider(res.data.setting?.provider ?? "OFF");
    setModel(res.data.setting?.model ?? "");
    setApiKey("");
  }
  useEffect(() => {
    load().catch(() => setError("Could not load your AI settings."));
  }, []);

  async function run(action: () => Promise<unknown>, done: string) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await action();
      await load();
      setNotice(done);
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    if (provider === "OFF") return void run(() => api.put("/me/ai", { provider: "OFF" }), "AI suggestions are off and your key was deleted.");
    void run(() => api.put("/me/ai", { provider, apiKey: apiKey.trim(), model: model.trim() }), "Key checked and saved.");
  }

  if (!state) return <div className="py-10 text-center text-sm text-[#63749b]">{error || "Loading…"}</div>;
  const saved = state.setting;
  const sameProvider = saved && saved.provider === provider;

  return (
    <div className="space-y-6">
      <PageHero eyebrow="Account" title="AI Assistant" description="Optional: your own key for AI suggestions on Feishu tickets" Icon={Sparkles} />
      <Section title="Your AI key">
        <form onSubmit={save} className="grid max-w-xl gap-4">
          <p className="text-sm text-[#294477]">
            When you press <strong>Create ticket</strong> on a Feishu card, AI suggests a one-line summary, the ticket type and the fault type. It runs only then,
            uses your own key, and its usage is billed to your account with the provider. Without a key the form works the same, just without suggestions.
          </p>
          {state.available && !state.feishuLinked && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              This portal account is not linked to your Feishu account, so a key saved here will not be used. In Feishu, send
              <strong> bind </strong> to {bot} in a direct message, open the link and sign in with this account.
            </div>
          )}
          {!state.available && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">AI is not enabled on this server yet. Ask an administrator.</div>
          )}
          <Field label="Provider">
            <select value={provider} onChange={(e) => setProvider(e.target.value as Provider | "OFF")} disabled={!state.available || busy}>
              <option value="OFF">Off — no AI suggestions</option>
              {(Object.keys(PROVIDER_LABEL) as Provider[]).map((p) => (
                <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>
              ))}
            </select>
          </Field>
          {provider !== "OFF" && (
            <>
              <Field label="API key">
                <input
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={sameProvider ? `Saved: ${saved!.maskedKey} — leave empty to keep it` : "sk-…"}
                  disabled={busy}
                />
              </Field>
              <p className="-mt-2 text-xs text-[#63749b]">{KEY_HELP[provider]} The key is checked with a tiny request, stored encrypted, and never shown again.</p>
              <Field label="Model (optional)">
                <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={`Default: ${state.providers[provider].defaultModel}`} maxLength={100} disabled={busy} />
              </Field>
            </>
          )}
          <ErrorText message={error} />
          {notice && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div>}
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-primary"
              disabled={busy || !state.available || (provider === "OFF" ? !saved : !apiKey.trim() && !sameProvider)}
            >
              {provider === "OFF" ? "Turn off and delete key" : "Check and save"}
            </button>
            {saved && (
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => run(() => api.post("/me/ai/test"), "Your saved key works.")}>
                Test saved key
              </button>
            )}
          </div>
          {saved && (
            <p className="text-xs text-[#8595b6]">
              Saved: {PROVIDER_LABEL[saved.provider]} · {saved.maskedKey} · model {saved.model || state.providers[saved.provider].defaultModel}
            </p>
          )}
        </form>
      </Section>
    </div>
  );
}
