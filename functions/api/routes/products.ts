import { all, id } from "../../lib/db";
import { admin, body, createApp } from "./_shared";
import { registerCrud } from "./crud";

export const productRoutes = createApp();

registerCrud(productRoutes, "categories", ["code", "nameEn", "nameZh"]);
registerCrud(productRoutes, "products", ["code", "nameEn", "nameZh", "categoryId", "status"]);

productRoutes.get("/products/:id/fields", async (c) => {
  const lang = c.req.query("language") === "ZH" ? "ZH" : "EN";
  return c.json(
    await all(
      c.env.DB,
      "SELECT * FROM productFields WHERE productId = ? AND language = ? ORDER BY sortOrder, label",
      c.req.param("id"),
      lang
    )
  );
});

productRoutes.post("/products/:id/fields", async (c) => {
  admin(c);
  const d = await body<any>(c);
  const fieldId = id("fld");
  await c.env.DB.prepare(
    "INSERT INTO productFields (id, productId, language, label, fieldType, options, defaultValue, sortOrder) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      fieldId,
      c.req.param("id"),
      d.language === "ZH" ? "ZH" : "EN",
      d.label,
      d.fieldType === "DROPDOWN" ? "DROPDOWN" : "TEXT",
      JSON.stringify(d.options ?? []),
      d.defaultValue ?? "",
      Number(d.sortOrder ?? 0)
    )
    .run();
  return c.json({ id: fieldId });
});

productRoutes.post("/products/:id/fields-bulk", async (c) => {
  admin(c);
  const d = await body<{ fields: any[] }>(c);
  const fields = Array.isArray(d.fields) ? d.fields : [];
  if (!fields.length) return c.json({ ids: [] });
  const productId = c.req.param("id");
  const insert = c.env.DB.prepare(
    "INSERT INTO productFields (id, productId, language, label, fieldType, options, defaultValue, sortOrder) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const ids: string[] = [];
  const stmts = fields.map((f) => {
    const fieldId = id("fld");
    ids.push(fieldId);
    return insert.bind(
      fieldId,
      productId,
      f.language === "ZH" ? "ZH" : "EN",
      f.label,
      f.fieldType === "DROPDOWN" ? "DROPDOWN" : "TEXT",
      JSON.stringify(f.options ?? []),
      f.defaultValue ?? "",
      Number(f.sortOrder ?? 0)
    );
  });
  await c.env.DB.batch(stmts);
  return c.json({ ids });
});

productRoutes.patch("/products/:productId/fields/:id", async (c) => {
  admin(c);
  const d = await body<any>(c);
  await c.env.DB.prepare(
    "UPDATE productFields SET label=?, fieldType=?, options=?, defaultValue=?, sortOrder=? WHERE id=?"
  )
    .bind(
      d.label,
      d.fieldType,
      JSON.stringify(d.options ?? []),
      d.defaultValue ?? "",
      Number(d.sortOrder ?? 0),
      c.req.param("id")
    )
    .run();
  return c.json({ ok: true });
});

productRoutes.delete("/products/:productId/fields/:id", async (c) => {
  admin(c);
  await c.env.DB.prepare("DELETE FROM productFields WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});
