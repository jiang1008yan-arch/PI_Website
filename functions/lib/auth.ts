import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import type { AppUser, Env } from "./types";

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
    role: payload.role === "ADMIN" ? "ADMIN" : "USER"
  };
}

export function requireAdmin(user: AppUser) {
  if (user.role !== "ADMIN") {
    throw new Response(JSON.stringify({ error: "Admin access required" }), { status: 403 });
  }
}
