# A separate cron Worker triggers the portal's scheduled jobs

The portal runs on Cloudflare Pages, and Pages Functions have no cron triggers: the `onScheduled` export in `functions/scheduled.ts` was never called, so purging expired PIs and retrying failed Feishu pushes never actually ran. The new weekly summary, owner reminders and Feishu request expiry need a clock too. We add a tiny Worker (`workers/cron`) whose only job is to call `POST /api/internal/cron` every 30 minutes with a shared `CRON_SECRET`; the portal runs every job from there (`runScheduledJobs`), each independently so one failure does not stop the rest. Jobs are written to be safe to run often: each decides from the database whether there is work (the weekly summary records the week it was sent for; reminders record when each ticket was last reminded).

## Considered Options

- **Move the whole portal from Pages to a Worker with cron triggers** — rejected for now: a larger migration of build and routing for one missing feature.
- **GitHub Actions on a schedule calling the endpoint** — rejected: the schedule is best-effort and can lag or be skipped, and it ties operations to the repository host.

## Consequences

Two deployables instead of one: the cron Worker must be deployed once and given the same `CRON_SECRET` and the portal's address. Locally, call `POST /api/internal/cron` by hand with the secret to run the jobs.
