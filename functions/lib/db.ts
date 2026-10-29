// SQLite's CURRENT_TIMESTAMP text ("YYYY-MM-DD HH:MM:SS", UTC), comparable as a string.
export const sqlTime = (date: Date) => date.toISOString().slice(0, 19).replace("T", " ");
export const parseSqlTime = (value: string) => new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);

export function id(prefix = "id") {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export async function all<T = Record<string, unknown>>(db: D1Database, sql: string, ...binds: unknown[]) {
  return (await db.prepare(sql).bind(...binds).all<T>()).results ?? [];
}

export async function first<T = Record<string, unknown>>(db: D1Database, sql: string, ...binds: unknown[]) {
  return await db.prepare(sql).bind(...binds).first<T>();
}
