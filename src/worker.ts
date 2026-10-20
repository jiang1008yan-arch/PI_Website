import { app } from "../functions/api/[[path]]";
import { runJanitor } from "../functions/scheduled";
import type { Env } from "../functions/lib/types";

// Single Worker entry: SPA static assets + Hono API + queue consumer + cron.
// wrangler.toml sets `run_worker_first = true`, so every request lands here;
// `/api/*` goes to Hono and everything else to the assets binding, which
// applies the single-page-application fallback (deep links → index.html).
// Running first matters for navigations to `/api/files/...` (download links),
// which the assets layer would otherwise answer with index.html.
export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return app.fetch(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },

  // Consumer for the `app-jobs` queue. Job types (NOTIFY / ANALYZE / ANSWER)
  // arrive with the Feishu bot phases; until then just log and ack so nothing
  // piles up or lands in the dead-letter queue.
  async queue(batch, _env, _ctx) {
    for (const message of batch.messages) {
      console.log("queue message", batch.queue, message.id, JSON.stringify(message.body));
      message.ack();
    }
  },

  async scheduled(event, env, _ctx) {
    console.log("scheduled", event.cron);
    await runJanitor(env);
  }
} satisfies ExportedHandler<Env>;
