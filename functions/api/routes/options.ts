import { all, id } from "../../lib/db";
import { canManageFaultTypes } from "../../lib/ticketAccess";
import { admin, body, createApp } from "./_shared";

// Option lists are ADMIN-managed, except the after-sales fault type list,
// which after-sales maintain themselves.
export const FAULT_TYPE_OPTION_KEY = "faultType";

export const optionRoutes = createApp();

optionRoutes.get("/options/:key", async (c) => {
  return c.json(
    await all(
      c.env.DB,
      "SELECT id, value, sortOrder FROM appOptions WHERE optionKey = ? ORDER BY sortOrder, value",
      c.req.param("key")
    )
  );
});

optionRoutes.put("/options/:key", async (c) => {
  if (c.req.param("key") === FAULT_TYPE_OPTION_KEY) {
    if (!canManageFaultTypes(c.get("user"))) return c.json({ error: "Forbidden" }, 403);
  } else {
    admin(c);
  }
  const d = await body<{ values: string[] }>(c);
  const values = (d.values ?? []).map((value) => String(value).trim()).filter(Boolean);
  await c.env.DB.prepare("DELETE FROM appOptions WHERE optionKey = ?").bind(c.req.param("key")).run();
  for (let i = 0; i < values.length; i++) {
    await c.env.DB.prepare("INSERT INTO appOptions (id, optionKey, value, sortOrder) VALUES (?, ?, ?, ?)")
      .bind(id("opt"), c.req.param("key"), values[i], i)
      .run();
  }
  return c.json({ ok: true });
});
