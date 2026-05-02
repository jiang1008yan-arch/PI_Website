import { getObject, putObject } from "../../lib/r2";
import { admin, createApp } from "./_shared";

export const fileRoutes = createApp();

fileRoutes.put("/files/:key", async (c) => {
  admin(c);
  await putObject(c.env, decodeURIComponent(c.req.param("key")), c.req.raw);
  return c.json({ ok: true });
});

fileRoutes.get("/files/:key", async (c) => getObject(c.env, decodeURIComponent(c.req.param("key"))));
