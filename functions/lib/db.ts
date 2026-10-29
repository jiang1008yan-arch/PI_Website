export function id(prefix = "id") {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export async function all<T = Record<string, unknown>>(db: D1Database, sql: string, ...binds: unknown[]) {
  return (await db.prepare(sql).bind(...binds).all<T>()).results ?? [];
}

export async function first<T = Record<string, unknown>>(db: D1Database, sql: string, ...binds: unknown[]) {
  return await db.prepare(sql).bind(...binds).first<T>();
}
