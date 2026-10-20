// Calls the portal's scheduled-jobs endpoint on each cron tick.
export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(run(env));
  },
  // Lets you trigger a run by hand with the secret: POST https://<worker>/run
  async fetch(request, env) {
    if (request.method !== "POST" || request.headers.get("x-cron-secret") !== env.CRON_SECRET) return new Response("Not found", { status: 404 });
    return new Response(await run(env), { headers: { "content-type": "application/json" } });
  }
};

async function run(env) {
  const res = await fetch(`${env.PORTAL_URL}/api/internal/cron`, { method: "POST", headers: { "x-cron-secret": env.CRON_SECRET } });
  const text = await res.text();
  if (!res.ok) console.error("Scheduled jobs failed", res.status, text);
  return text;
}
