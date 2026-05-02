import { all, first, id } from "../../lib/db";
import { objectUrl } from "../../lib/r2";
import { admin, body, createApp } from "./_shared";

export const templateRoutes = createApp();

templateRoutes.post("/products/:id/template/:lang/upload-url", (c) => {
  admin(c);
  const lang = c.req.param("lang").toLowerCase() === "zh" ? "zh" : "en";
  const key = `product-templates/${c.req.param("id")}/${lang}.xlsx`;
  return c.json({ key, uploadUrl: objectUrl(key) });
});

templateRoutes.post("/products/:id/template/:lang/commit", async (c) => {
  admin(c);
  const d = await body<any>(c);
  const lang = c.req.param("lang").toUpperCase() === "ZH" ? "ZH" : "EN";
  await c.env.DB.prepare(
    "INSERT INTO productTemplates (id, productId, language, r2Key, uploadedById) VALUES (?, ?, ?, ?, ?) ON CONFLICT(productId, language) DO UPDATE SET r2Key=excluded.r2Key, uploadedById=excluded.uploadedById, uploadedAt=CURRENT_TIMESTAMP"
  )
    .bind(id("ptm"), c.req.param("id"), lang, d.key, c.get("user").id)
    .run();
  return c.json({ ok: true });
});

templateRoutes.delete("/products/:id/template/:lang", async (c) => {
  admin(c);
  const lang = c.req.param("lang").toUpperCase() === "ZH" ? "ZH" : "EN";
  const row = await first<any>(
    c.env.DB,
    "SELECT r2Key FROM productTemplates WHERE productId=? AND language=?",
    c.req.param("id"),
    lang
  );
  if (row) await c.env.FILES.delete(row.r2Key);
  await c.env.DB.prepare("DELETE FROM productTemplates WHERE productId=? AND language=?")
    .bind(c.req.param("id"), lang)
    .run();
  return c.json({ ok: true });
});

templateRoutes.get("/excel-templates", async (c) => {
  admin(c);
  return c.json(await all(c.env.DB, "SELECT * FROM excelTemplates ORDER BY language"));
});

templateRoutes.post("/excel-templates", async (c) => {
  admin(c);
  const d = await body<any>(c);
  const lang = d.language === "ZH" ? "ZH" : "EN";
  await c.env.DB.prepare(
    "INSERT INTO excelTemplates (id, language, r2Key, anchorCellName, uploadedById) VALUES (?, ?, ?, ?, ?) ON CONFLICT(language) DO UPDATE SET r2Key=excluded.r2Key, anchorCellName=excluded.anchorCellName, uploadedById=excluded.uploadedById, uploadedAt=CURRENT_TIMESTAMP"
  )
    .bind(id("ext"), lang, d.r2Key, d.anchorCellName ?? "PRODUCTS_START", c.get("user").id)
    .run();
  return c.json({ ok: true });
});

templateRoutes.delete("/excel-templates/:language", async (c) => {
  admin(c);
  await c.env.DB.prepare("DELETE FROM excelTemplates WHERE language=?")
    .bind(c.req.param("language").toUpperCase())
    .run();
  return c.json({ ok: true });
});

templateRoutes.get("/contract-templates", async (c) =>
  c.json(await all(c.env.DB, "SELECT * FROM contractTemplates ORDER BY uploadedAt DESC"))
);

templateRoutes.post("/contract-templates", async (c) => {
  admin(c);
  const d = await body<any>(c);
  const tplId = id("ctm");
  await c.env.DB.prepare(
    "INSERT INTO contractTemplates (id, name, language, r2Key, size, uploadedById) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(tplId, d.name, d.language ?? "BOTH", d.r2Key, Number(d.size ?? 0), c.get("user").id)
    .run();
  return c.json({ id: tplId });
});

templateRoutes.get("/contract-templates/:id/download-url", async (c) => {
  const row = await first<any>(c.env.DB, "SELECT r2Key FROM contractTemplates WHERE id=?", c.req.param("id"));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ downloadUrl: objectUrl(row.r2Key) });
});

templateRoutes.delete("/contract-templates/:id", async (c) => {
  admin(c);
  const row = await first<any>(c.env.DB, "SELECT r2Key FROM contractTemplates WHERE id=?", c.req.param("id"));
  if (row) await c.env.FILES.delete(row.r2Key);
  await c.env.DB.prepare("DELETE FROM contractTemplates WHERE id=?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});
