import { FormEvent, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ErrorText, Field } from "../components/Form";

// "Sign in with Feishu" hands results back in the URL fragment (never sent to
// servers): feishuToken (linked account), feishuBind (first time: sign in once
// with a password to link), or feishuError.
function readFeishuFragment() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const next = params.get("next") ?? "/";
  return {
    token: params.get("feishuToken"),
    bind: params.get("feishuBind"),
    name: params.get("name") ?? "",
    error: params.get("feishuError"),
    next: next.startsWith("/") && !next.startsWith("//") ? next : "/"
  };
}

const inFeishuApp = () => /Lark|Feishu/i.test(navigator.userAgent);

function feishuStartUrl(next: string) {
  return `/api/auth/feishu/start?next=${encodeURIComponent(next)}`;
}

export function LoginPage() {
  const { user, login, loginWithToken } = useAuth();
  const navigate = useNavigate();
  const feishu = useMemo(readFeishuFragment, []);
  // Return to the page that required sign-in (e.g. a Feishu account-link link).
  const from = (useLocation().state as { from?: string } | null)?.from;
  const destination = feishu.next !== "/" ? feishu.next : from && from.startsWith("/") && !from.startsWith("//") ? from : "/";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(feishu.error ?? "");
  const [finishing, setFinishing] = useState(Boolean(feishu.token));

  useEffect(() => {
    if (feishu.token || feishu.bind || feishu.error) {
      // Drop the tokens from the address bar and history.
      window.history.replaceState(null, "", window.location.pathname);
    }
    if (feishu.token) {
      loginWithToken(feishu.token)
        .then(() => navigate(destination, { replace: true }))
        .catch(() => { setFinishing(false); setError("Feishu sign-in failed. Please try again."); });
      return;
    }
    // Inside the Feishu app, sign in with Feishu straight away (it is silent there).
    if (!user && !feishu.bind && !feishu.error && inFeishuApp()) window.location.href = feishuStartUrl(destination);
  }, []);

  if (user && !finishing) return <Navigate to={destination} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await login(username, password, feishu.bind ?? undefined);
      if (feishu.bind) navigate(destination, { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Login failed");
    }
  }

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden px-4">
      <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-[#dfe8fb]" />
      <div className="absolute left-10 top-16 h-20 w-20 rotate-45 rounded-lg bg-gradient-to-br from-[#dbe6fb] to-[#8ca5e2] opacity-70 shadow-xl shadow-primary/10" />
      <form onSubmit={submit} className="card relative w-full max-w-md space-y-5 p-8" autoComplete="off">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[#07183f]">Welcome back</h1>
        </div>
        {finishing && <p className="text-sm text-[#63749b]">Signing you in with Feishu…</p>}
        {feishu.bind && (
          <div className="rounded-lg bg-[#eef4ff] p-3 text-sm text-[#294477]">
            Link your Feishu account{feishu.name ? ` (${feishu.name})` : ""}: sign in once with your Sales Portal
            username and password. After that, Feishu signs you in automatically.
          </div>
        )}
        <ErrorText message={error} />
        <Field label="Username">
          <input
            name="pi-portal-username"
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
        <Field label="Password">
          <input
            name="pi-portal-password"
            autoComplete="new-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <button className="btn-primary w-full">{feishu.bind ? "Sign In & Link Feishu" : "Sign In"}</button>
        {!feishu.bind && (
          <button type="button" className="btn-secondary w-full" onClick={() => { window.location.href = feishuStartUrl(destination); }}>
            Sign in with Feishu
          </button>
        )}
      </form>
    </div>
  );
}
