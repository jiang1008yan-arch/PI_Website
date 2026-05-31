import { requireRole } from "../../lib/auth";
import { all, id } from "../../lib/db";
import { body, createApp } from "./_shared";

export const ticketFieldRoutes = createApp();

// ADMIN owns global config; SERVICE owns the after-sales workflow, so both may
// edit the ticket questionnaire. SALES is read-only here.
const canEditFields = (c: { get: (key: "user") => Parameters<typeof requireRole>[0] }) =>
  requireRole(c.get("user"), ["ADMIN", "SERVICE"]);

// Any authenticated user can read the questionnaire config (the editor needs it;
// the public form reads it through the whitelisted public route instead).
ticketFieldRoutes.get("/ticket-fields", async (c) =>
  c.json(await all(c.env.DB, "SELECT * FROM ticketFields ORDER BY sortOrder, label"))
);

ticketFieldRoutes.post("/ticket-fields", async (c) => {
  canEditFields(c);
  const d = await body<any>(c);
  const fieldId = id("tfd");
  await c.env.DB.prepare(
    "INSERT INTO ticketFields (id, label, fieldType, options, required, sortOrder) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(
      fieldId,
      d.label,
      d.fieldType === "DROPDOWN" ? "DROPDOWN" : "TEXT",
      JSON.stringify(d.options ?? []),
      d.required ? 1 : 0,
      Number(d.sortOrder ?? 0)
    )
    .run();
  return c.json({ id: fieldId });
});

ticketFieldRoutes.post("/ticket-fields-bulk", async (c) => {
  canEditFields(c);
  const d = await body<{ fields: any[] }>(c);
  const fields = Array.isArray(d.fields) ? d.fields : [];
  if (!fields.length) return c.json({ ids: [] });
  const insert = c.env.DB.prepare(
    "INSERT INTO ticketFields (id, label, fieldType, options, required, sortOrder) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const ids: string[] = [];
  const stmts = fields.map((f) => {
    const fieldId = id("tfd");
    ids.push(fieldId);
    return insert.bind(
      fieldId,
      f.label,
      f.fieldType === "DROPDOWN" ? "DROPDOWN" : "TEXT",
      JSON.stringify(f.options ?? []),
      f.required ? 1 : 0,
      Number(f.sortOrder ?? 0)
    );
  });
  await c.env.DB.batch(stmts);
  return c.json({ ids });
});

ticketFieldRoutes.patch("/ticket-fields/:id", async (c) => {
  canEditFields(c);
  const d = await body<any>(c);
  await c.env.DB.prepare(
    "UPDATE ticketFields SET label=?, fieldType=?, options=?, required=?, sortOrder=? WHERE id=?"
  )
    .bind(
      d.label,
      d.fieldType === "DROPDOWN" ? "DROPDOWN" : "TEXT",
      JSON.stringify(d.options ?? []),
      d.required ? 1 : 0,
      Number(d.sortOrder ?? 0),
      c.req.param("id")
    )
    .run();
  return c.json({ ok: true });
});

ticketFieldRoutes.delete("/ticket-fields/:id", async (c) => {
  canEditFields(c);
  await c.env.DB.prepare("DELETE FROM ticketFields WHERE id=?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});
