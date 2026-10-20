# Sales Portal

Internal Proforma Invoice web app for English and Chinese PI creation, admin approval, template management, and browser-side Excel export.

## Stack

- React 18 + Vite + TypeScript + Tailwind CSS
- One Cloudflare Worker (`src/worker.ts`): Hono API, SPA static assets, queue consumer, hourly cron
- Cloudflare D1 with Drizzle schema and SQL migration
- Cloudflare R2 for Excel and contract files
- ExcelJS in the browser for `.xlsx` generation
- JWT auth with `jose`, password hashing with `bcryptjs`

## Local Setup

```powershell
npm install
npm run build
npm run db:migrate:local
npm run dev
```

`npm run dev` runs `wrangler dev` on http://localhost:8788 and serves the built `web/dist`. Put local secrets in `.dev.vars` (gitignored), e.g. `JWT_SECRET=...` and `ALLOW_DEFAULT_ADMIN=true`.

With `ALLOW_DEFAULT_ADMIN=true`, seed credentials are created lazily on the first API request against an empty database:

- Username: `admin`
- Password: `Admin@123`

Change this password/user after first login in any real environment.

## Development

For frontend-only iteration:

```powershell
npm run dev:web
```

`npm run dev:web` proxies `/api` to `http://127.0.0.1:8788`, so run `npm run dev` alongside it for the API with local D1/R2.

To trigger the hourly janitor locally:

```powershell
npx wrangler dev --test-scheduled
# then open http://localhost:8788/__scheduled
```

## Implemented Batches

- Batch 1: project scaffold, auth, users, roles, protected routes, sender profile.
- Batch 2: categories, products, EN/ZH product fields, product sub-template uploads, PI header templates, contract templates.
- Batch 3: EN/ZH PI creation, item snapshots, EN submit, ZH send/review/approve/reject workflow.
- Batch 4: browser-side ExcelJS export using header templates, product sub-templates, token replacement, totals.
- Batch 5: hourly scheduled janitor (Worker cron) that purges DRAFT PIs untouched for 3 days; PI numbering is kept in an independent sequence table. Approved Chinese PIs are kept permanently.

## Excel Template Notes

Header templates can use these tokens:

- Common: `${piNo}`, `${date}`, `${customer.company}`, `${customer.contact}`, `${customer.email}`, `${customer.phone}`, `${customer.country}`, `${customer.address}`, `${sender.corp}`, `${sender.address}`, `${sender.from}`, `${sender.phone}`, `${sender.email}`
- English: `${validUntil}`, `${incoterm}`, `${shipmentMode}`, `${paymentTerm}`
- Chinese: `${productionOrderNo}`, `${customerSource}`, `${customerType}`, `${deliveryDate}`

Set a defined name called `PRODUCTS_START` on the first product row. If no template is uploaded, the app creates a simple fallback workbook.

Product sub-templates can use `${field.<label>}` tokens, where `<label>` matches the field label captured on the PI item.

## Cloudflare Deploy

```powershell
wrangler d1 create sales-portal-db
wrangler d1 migrations apply sales-portal-db --remote
wrangler r2 bucket create sales-portal-files
wrangler queues create app-jobs
wrangler queues create app-jobs-dlq
wrangler secret put JWT_SECRET
npm run deploy
```

Update `wrangler.toml` with the real D1 database id before deploying. See `docs/deploy-and-migrations.md` for the Pages → Worker cutover.
