import type { Env } from "./types";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// 需求2 — verify a Cloudflare Turnstile token on the public ticket submission.
// When TURNSTILE_SECRET is unset (local dev) verification is skipped so the
// flow stays testable; production must configure the secret.
export async function verifyTurnstile(env: Env, token: unknown, ip?: string | null): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return true;
  if (typeof token !== "string" || !token) return false;
  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  if (ip) form.set("remoteip", ip);
  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
