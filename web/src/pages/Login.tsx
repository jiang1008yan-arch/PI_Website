import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ErrorText, Field } from "../components/Form";

export function LoginPage() {
  const { user, login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  if (user) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await login(username, password);
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Login failed");
    }
  }

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden px-4">
      <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-[#dfe8fb]" />
      <div className="absolute left-10 top-16 h-20 w-20 rotate-45 rounded-lg bg-gradient-to-br from-[#dbe6fb] to-[#8ca5e2] opacity-70 shadow-xl shadow-primary/10" />
      <form onSubmit={submit} className="card relative w-full max-w-md space-y-5 p-8">
        <div>
          <div className="mb-5 grid h-12 w-12 place-items-center rounded-full bg-primary text-lg font-bold text-white shadow-lg shadow-primary/20">PI</div>
          <h1 className="text-3xl font-semibold tracking-tight text-[#07183f]">Welcome back</h1>
          <p className="mt-2 text-sm text-[#63749b]">Sign in to create and review PIs.</p>
        </div>
        <ErrorText message={error} />
        <Field label="Username"><input value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
        <Field label="Password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <button className="btn-primary w-full">Sign In</button>
      </form>
    </div>
  );
}
