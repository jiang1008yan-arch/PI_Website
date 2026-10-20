import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import type { AppUser, Env, Role } from "./types";

const ROLES: Role[] = ["ADMIN", "SALES", "SERVICE", "COMMERCE", "PRESALES"];
const asRole = (value: unknown): Role => (ROLES.includes(value as Role) ? (value as Role) : "SALES");

const encoder = new TextEncoder();

export async function hashPassword(password: string) {
  return await bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return await bcrypt.compare(password, hash);
}

export async function signJwt(env: Env, user: AppUser) {
  return await new SignJWT(user)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(encoder.encode(env.JWT_SECRET));
}

export async function verifyJwt(env: Env, token: string): Promise<AppUser> {
  const { payload } = await jwtVerify(token, encoder.encode(env.JWT_SECRET));
  return {
    id: String(payload.id),
    username: String(payload.username),
    displayName: String(payload.displayName),
    role: asRole(payload.role)
  };
}

export function requireAdmin(user: AppUser) {
  if (user.role !== "ADMIN") {
    throw new Response(JSON.stringify({ error: "Admin access required" }), { status: 403 });
  }
}

export function requireRole(user: AppUser, roles: Role[]) {
  if (!roles.includes(user.role)) {
    throw new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }
}

// Short-lived signed tokens for one purpose (Feishu sign-in state, account
// binding). Signed with a key derived from JWT_SECRET + purpose, so they can
// never verify as a session token (verifyJwt) or as another purpose's token.
const purposeKey = (env: Env, purpose: string) => encoder.encode(`${env.JWT_SECRET}:${purpose}`);

export async function signPurposeToken(env: Env, purpose: string, payload: Record<string, unknown>, ttl: string) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(purposeKey(env, purpose));
}

export async function verifyPurposeToken<T>(env: Env, purpose: string, token: string): Promise<T> {
  const { payload } = await jwtVerify(token, purposeKey(env, purpose));
  return payload as T;
}
