import { first } from "../../lib/db";
import { admin, body, createApp } from "./_shared";

export const senderProfileRoutes = createApp();

senderProfileRoutes.get("/sender-profile", async (c) =>
  c.json(await first(c.env.DB, "SELECT * FROM senderProfile WHERE id = 1"))
);

senderProfileRoutes.put("/sender-profile", async (c) => {
  admin(c);
  const d = await body<any>(c);
  await c.env.DB.prepare(
    "UPDATE senderProfile SET corp=?, address=?, fromName=?, phone=?, email=? WHERE id=1"
  )
    .bind(d.corp ?? "", d.address ?? "", d.fromName ?? "", d.phone ?? "", d.email ?? "")
    .run();
  return c.json({ ok: true });
});
