# Sales Portal

Internal Proforma Invoice web app for English and Chinese PI creation, admin approval, template management, and browser-side Excel export.

## Stack

- React 18 + Vite + TypeScript + Tailwind CSS
- Cloudflare Pages Functions + Hono
- Cloudflare D1 with Drizzle schema and SQL migration
- Cloudflare R2 for Excel and contract files
- ExcelJS in the browser for `.xlsx` generation
- JWT auth with `jose`, password hashing with `bcryptjs`

## Local Setup

```powershell
npm install
npm run build
wrangler d1 migrations apply sales-portal-db --local
wrangler pages dev web/dist
```

Seed credentials are created lazily on the first API request:

- Username: `admin`
- Password: `Admin@123`

Change this password/user after first login in any real environment.

## Development

For frontend-only iteration:

```powershell
npm run dev:web
```

For Pages Functions + D1/R2 local testing, build the SPA and run Pages dev:

```powershell
npm run build
wrangler d1 migrations apply sales-portal-db --local
wrangler pages dev web/dist
```

## Implemented Batches

- Batch 1: project scaffold, auth, users, roles, protected routes, sender profile.
- Batch 2: categories, products, EN/ZH product fields, product sub-template uploads, PI header templates, contract templates.
- Batch 3: EN/ZH PI creation, item snapshots, EN submit, ZH send/review/approve/reject workflow.
- Batch 4: browser-side ExcelJS export using header templates, product sub-templates, token replacement, totals.
- Batch 5: scheduled janitor for approved Chinese PIs older than 14 days, with PI numbering kept in an independent sequence table so expired PI rows can be hard-deleted.

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
wrangler pages secret put JWT_SECRET
npm run deploy
```

Update `wrangler.toml` with the real D1 database id before deploying.
