import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import type { AppUser, Env, Role } from "./types";

const ROLES: Role[] = ["ADMIN", "SALES", "SERVICE"];
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
