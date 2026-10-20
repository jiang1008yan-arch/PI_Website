import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { app } from "../api/[[path]]";
import { signJwt } from "../lib/auth";
import type { AppUser, Env, Role } from "../lib/types";

// Integration-test harness: a fresh in-memory D1 per `createHarness()`, with every
// migration in migrations/ applied in filename order — the same schema the live
// database gets — and one user per role. Requests go straight into the Hono app.

const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations", import.meta.url));

// D1 prepares one statement at a time, so split each migration file into its
// statements. Our migrations keep comments on their own lines and never put a
// semicolon inside a string literal, which keeps this split safe.
function migrationStatements(sql: string): string[] {
  return sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type Harness = {
  env: Env;
  db: D1Database;
  users: Record<Role, AppUser>;
  /** Calls the API as `as` (a role or a user); JSON body in, `{ status, body }` out. */
  request: (as: Role | AppUser | null, method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;
  /** Sends a raw request (custom headers/body), e.g. a Feishu push. */
  raw: (method: string, path: string, body: string, headers?: Record<string, string>) => Promise<{ status: number; body: any }>;
  /** Sends any body (e.g. a file) as `as` and returns the raw Response (e.g. a download). */
  fetchAs: (as: Role | AppUser, method: string, path: string, body?: BodyInit, headers?: Record<string, string>) => Promise<Response>;
  /** Waits for work handlers deferred past the response (executionCtx.waitUntil). */
  settle: () => Promise<void>;
  close: () => Promise<void>;
};

const ROLES: Role[] = ["ADMIN", "SALES", "SERVICE", "COMMERCE"];

/** A fresh, empty in-memory D1 (no migrations applied) and R2 bucket. */
export async function createD1(): Promise<{ db: D1Database; files: R2Bucket; close: () => Promise<void> }> {
  const mf = new Miniflare({ modules: true, script: "export default {}", d1Databases: ["DB"], r2Buckets: ["FILES"] });
  const db = (await mf.getD1Database("DB")) as unknown as D1Database;
  const files = (await mf.getR2Bucket("FILES")) as unknown as R2Bucket;
  return { db, files, close: () => mf.dispose() };
}

/** Applies migrations in filename order; `only` limits which files run. */
export async function applyMigrations(db: D1Database, only: (file: string) => boolean = () => true) {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort().filter(only);
  for (const file of files) {
    for (const stmt of migrationStatements(readFileSync(join(MIGRATIONS_DIR, file), "utf8"))) {
      await db.prepare(stmt).run();
    }
  }
}

export async function createHarness(envOverrides: Partial<Env> = {}): Promise<Harness> {
  const { db, files, close } = await createD1();
  await applyMigrations(db);
  await db.prepare("INSERT OR IGNORE INTO senderProfile (id, corp, address, fromName, phone, email) VALUES (1, '', '', '', '', '')").run();

  const env = { DB: db, FILES: files, JWT_SECRET: "test-secret", ...envOverrides } as Env;

  const users = {} as Record<Role, AppUser>;
  for (const role of ROLES) {
    const user: AppUser = { id: `usr_${role.toLowerCase()}`, username: role.toLowerCase(), displayName: `Test ${role}`, role };
    await db
      .prepare("INSERT INTO users (id, username, passwordHash, displayName, role) VALUES (?, ?, 'x', ?, ?)")
      .bind(user.id, user.username, user.displayName, role)
      .run();
    users[role] = user;
  }

  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => void pending.push(p.catch(() => {})),
    passThroughOnException: () => {}
  };
  async function settle() {
    while (pending.length) await Promise.all(pending.splice(0));
  }

  async function request(as: Role | AppUser | null, method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (as) {
      const user = typeof as === "string" ? users[as] : as;
      headers.authorization = `Bearer ${await signJwt(env, user)}`;
    }
    return send(method, path, body === undefined ? undefined : JSON.stringify(body), headers);
  }

  async function raw(method: string, path: string, body: string, headers: Record<string, string> = {}) {
    return send(method, path, body, { "content-type": "application/json", ...headers });
  }

  async function fetchAs(as: Role | AppUser, method: string, path: string, body?: BodyInit, headers: Record<string, string> = {}) {
    const user = typeof as === "string" ? users[as] : as;
    const auth = { authorization: `Bearer ${await signJwt(env, user)}`, ...headers };
    return app.fetch(new Request(`http://test/api${path}`, { method, headers: auth, body }), env, ctx as unknown as ExecutionContext);
  }

  async function send(method: string, path: string, body: string | undefined, headers: Record<string, string>) {
    const hasBody = method !== "GET" && method !== "HEAD";
    const res = await app.fetch(new Request(`http://test/api${path}`, { method, headers, body: hasBody ? body : undefined }), env, ctx as unknown as ExecutionContext);
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // non-JSON response — keep the raw text
    }
    return { status: res.status, body: parsed };
  }

  return { env, db, users, request, raw, fetchAs, settle, close };
}

/** Inserts an ACTIVE product with no fields; returns its id. */
export async function seedProduct(db: D1Database, code = "P1"): Promise<string> {
  const categoryId = `cat_${code}`;
  await db.prepare("INSERT INTO categories (id, code, nameEn, nameZh) VALUES (?, ?, ?, ?)").bind(categoryId, `C${code}`, "Cat", "类").run();
  const productId = `prd_${code}`;
  await db
    .prepare("INSERT INTO products (id, code, nameEn, nameZh, categoryId, status) VALUES (?, ?, ?, ?, ?, 'ACTIVE')")
    .bind(productId, code, `Charger ${code}`, `充电桩 ${code}`, categoryId)
    .run();
  return productId;
}
