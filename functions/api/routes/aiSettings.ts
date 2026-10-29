import { AI_PROVIDERS, testAiKey, type AiProvider } from "../../lib/aiTriage";
import { loadUserAiConfig, loadUserAiRow, maskApiKey, removeUserAiKey, saveUserAiKey } from "../../lib/personalAiKey";
import { canUseTickets } from "../../lib/ticketAccess";
import { body, createApp } from "./_shared";

// Each user's own AI provider key (Qwen or DeepSeek) for ticket suggestions.
// Keys are write-only: they are checked with a tiny request before saving,
// stored encrypted, and only ever shown masked.

export const aiSettingsRoutes = createApp();

aiSettingsRoutes.use("/me/ai", async (c, next) => {
  if (!canUseTickets(c.get("user"))) return c.json({ error: "Forbidden" }, 403);
  await next();
});
aiSettingsRoutes.use("/me/ai/*", async (c, next) => {
  if (!canUseTickets(c.get("user"))) return c.json({ error: "Forbidden" }, 403);
  await next();
});

aiSettingsRoutes.get("/me/ai", async (c) => {
  const row = await loadUserAiRow(c.env.DB, c.get("user").id);
  // AI runs for the Feishu account linked to this user, so say if there is none.
  const linked = await c.env.DB.prepare("SELECT (feishuUnionId IS NOT NULL OR feishuOpenId IS NOT NULL) AS linked FROM users WHERE id = ?").bind(c.get("user").id).first<{ linked: number }>();
  return c.json({
    available: Boolean(c.env.AI_KEY_SECRET),
    feishuLinked: Boolean(linked?.linked),
    providers: Object.fromEntries(Object.entries(AI_PROVIDERS).map(([k, v]) => [k, { defaultModel: v.defaultModel }])),
    setting: row ? { provider: row.provider, model: row.model, maskedKey: maskApiKey(row.apiKeyLast4), updatedAt: row.updatedAt } : null
  });
});

aiSettingsRoutes.put("/me/ai", async (c) => {
  const user = c.get("user");
  const d = await body<{ provider?: string; apiKey?: string; model?: string }>(c);
  const provider = String(d.provider ?? "");
  if (provider === "OFF") {
    await removeUserAiKey(c.env.DB, user.id);
    return c.json({ ok: true });
  }
  if (!c.env.AI_KEY_SECRET) return c.json({ error: "AI is not enabled on this server yet. Ask an administrator." }, 400);
  if (!(provider in AI_PROVIDERS)) return c.json({ error: "Choose Qwen or DeepSeek." }, 400);
  const model = String(d.model ?? "").trim().slice(0, 100) || null;
  const newKey = String(d.apiKey ?? "").trim();

  // No new key: keep the saved one (it must exist) and only change the model.
  let apiKey = newKey;
  if (!apiKey) {
    const saved = await loadUserAiConfig(c.env, user.id);
    if (!saved || saved.provider !== provider) return c.json({ error: "Enter your API key." }, 400);
    apiKey = saved.apiKey;
  }
  if (apiKey.length < 8 || apiKey.length > 300 || /\s/.test(apiKey)) return c.json({ error: "That does not look like an API key." }, 400);

  const check = await testAiKey({ provider: provider as AiProvider, apiKey, model });
  if (!check.ok) return c.json({ error: `The provider rejected this key or model: ${check.error}` }, 400);

  const maskedKey = await saveUserAiKey(c.env.AI_KEY_SECRET, c.env.DB, user.id, { provider: provider as AiProvider, apiKey, model });
  return c.json({ ok: true, maskedKey });
});

aiSettingsRoutes.post("/me/ai/test", async (c) => {
  const config = await loadUserAiConfig(c.env, c.get("user").id);
  if (!config) return c.json({ error: "No AI key saved." }, 400);
  const check = await testAiKey(config);
  return check.ok ? c.json({ ok: true }) : c.json({ error: check.error }, 400);
});
