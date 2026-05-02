import { all, first, id } from "../../lib/db";
import { admin, AppEnv, body } from "./_shared";
import type { Hono } from "hono";

export function registerCrud(
  app: Hono<AppEnv>,
  table: string,
  fields: string[],
  adminWrite = true
) {
  app.get(`/${table}`, async (c) =>
    c.json(
      await all(
        c.env.DB,
        `SELECT * FROM ${table} ORDER BY ${table === "products" ? "nameEn, nameZh" : "nameEn"}`
      )
    )
  );
  app.post(`/${table}`, async (c) => {
    if (adminWrite) admin(c);
    const d = await body<any>(c);
    if (table === "products" && !d.categoryId) d.categoryId = await ensureDefaultCategory(c.env.DB);
    const rowId = id(table.slice(0, 3));
    const cols = ["id", ...fields];
    const vals = [rowId, ...fields.map((f) => d[f])];
    await c.env.DB.prepare(
      `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`
    )
      .bind(...vals)
      .run();
    return c.json({ id: rowId });
  });
  app.patch(`/${table}/:id`, async (c) => {
    if (adminWrite) admin(c);
    const d = await body<any>(c);
    const present = fields.filter((f) => d[f] !== undefined);
    if (present.length) {
      await c.env.DB.prepare(
        `UPDATE ${table} SET ${present.map((f) => `${f} = ?`).join(", ")} WHERE id = ?`
      )
        .bind(...present.map((f) => d[f]), c.req.param("id"))
        .run();
    }
    return c.json({ ok: true });
  });
  app.delete(`/${table}/:id`, async (c) => {
    if (adminWrite) admin(c);
    await c.env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(c.req.param("id")).run();
    return c.json({ ok: true });
  });
}

export async function ensureDefaultCategory(db: D1Database) {
  const existing = await first<{ id: string }>(db, "SELECT id FROM categories WHERE code = 'GENERAL'");
  if (existing?.id) return existing.id;
  const categoryId = id("cat");
  await db
    .prepare("INSERT INTO categories (id, code, nameEn, nameZh) VALUES (?, 'GENERAL', 'General', 'General')")
    .bind(categoryId)
    .run();
  return categoryId;
}
