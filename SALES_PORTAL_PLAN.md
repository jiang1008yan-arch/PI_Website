# Sales Portal — Implementation Plan

## Context

Sales staff currently produce Proforma Invoices (PIs) by hand-editing Excel files. This is error-prone, visually inconsistent, and reviewers can't keep PI templates and product spec fields up to date. We're building a single internal web app (greenfield, empty repo) where:

- Sales staff log in to fill out PIs (English or Chinese).
- Chinese PIs go through an **Admin approval workflow** — sales clicks "Send to Admin", Admin reviews on-page, then downloads the Excel.
- Admins maintain products, bilingual spec fields, contract templates, and per-product Excel sub-templates (separate EN and ZH versions per product).
- The output is `.xlsx` (sales counterparties expect Excel).

**Hosting target: Cloudflare's free tier** (Pages + Pages Functions + D1 + R2 + Cron Triggers). The 10 ms CPU/request cap on free Workers forces Excel stitching to run **in the browser**; the Worker only returns JSON + presigned R2 URLs.

This plan supersedes earlier drafts and incorporates these confirmed deltas:

1. Remove the stats tiles (Orders This Month / Pending Approval / Products Available / Completed Orders) from Home.
2. EN PI and ZH PI have **different** header cards.
3. Custom product fields are **two independent lists per product** (EN field list + ZH field list).
4. Per-product Excel sub-templates are **per-language**: each product can have an EN sub-template and a ZH sub-template, uploaded separately.
5. **Chinese PI approval workflow**: sales sends to Admin → Admin reviews on-page → Admin downloads Excel. (English PI keeps the simple Draft/Submitted flow; sales can export Excel directly.)
6. Multiple admin accounts are supported (any user can be promoted to ADMIN).
7. **2-week cleanup cron**: APPROVED Chinese PIs are soft-archived 14 days after approval (hidden from listings but row retained so PI numbers don't collide).

## Stack

- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS, React Router, TanStack Query, Axios, **ExcelJS in the browser** for export, FileSaver.js for download.
- **Backend**: **Hono** running as **Cloudflare Pages Functions** (same deploy + same origin as the SPA → no CORS). TypeScript, ESM only.
- **DB**: **Cloudflare D1** via **Drizzle ORM** + `drizzle-kit` for migrations.
- **Files**: **Cloudflare R2** bucket `sales-portal-files`, prefixes `contracts/`, `excel-templates/`, `product-templates/{productId}/{en|zh}.xlsx`. Worker mints short-lived signed GET/PUT URLs (S3 v4 via `aws4fetch`) so uploads/downloads bypass the Worker entirely.
- **Auth**: **`jose`** for JWT (HS256, signed with `JWT_SECRET` Worker secret), **`bcryptjs`** for password hashing (pure-JS, Workers-safe). 12 h token expiry.
- **Cron**: Cloudflare **Cron Triggers** (free tier) — daily janitor that soft-archives APPROVED PIs older than 14 days.
- **Local dev**: `wrangler pages dev` (D1 + R2 emulation against local SQLite + filesystem) + `vite dev` proxied through wrangler.

## Cloudflare Free-Tier Fit

| Resource | Free quota | Use here | Headroom |
|---|---|---|---|
| Pages | unlimited bandwidth, 500 builds/mo | React SPA + Pages Functions | fine |
| Workers (Pages Functions) | 100k req/day, **10 ms CPU/req** | Hono CRUD only; Excel moved to browser | fine |
| D1 | 5 GB, 5 M reads/day, 100 k writes/day | all relational data | fine for small sales team |
| R2 | 10 GB, 1 M Class-A ops/mo | contracts, EN/ZH header templates, per-product EN/ZH sub-templates | fine |
| Cron Triggers | 5 schedules free | daily janitor at 03:00 UTC | fine |

The 10 ms CPU/request cap is the real constraint — server-side ExcelJS stitching would blow past it. Browser-side stitching solves this and also avoids R2 egress through the Worker.

## As-Built Architecture (post-refactor)

The "Repo Layout" above describes the *target* shape from the original spec. The current codebase has been refactored for maintainability — no file exceeds ~340 lines, every module has a single responsibility, and shared logic is no longer duplicated across pages. Below is what actually exists today.

```
PI_Website/
├── functions/                           # Cloudflare Pages Functions (Hono, /api/*)
│   ├── api/
│   │   ├── [[path]].ts                  # Entry: cors + seed + error handler + JWT middleware → app.route("/", subApp)
│   │   └── routes/
│   │       ├── _shared.ts               # createApp(), body(), admin() — shared across all route modules
│   │       ├── auth.ts                  # POST /auth/login, GET /auth/me
│   │       ├── users.ts                 # /users CRUD + /review-recipients (last-admin guard)
│   │       ├── crud.ts                  # registerCrud() factory + ensureDefaultCategory()
│   │       ├── products.ts              # /products + /products/:id/fields (uses registerCrud)
│   │       ├── options.ts               # /options/:key generic key/value store (also stores model-rule JSON)
│   │       ├── templates.ts             # /excel-templates + /contract-templates + /products/:id/template/:lang
│   │       ├── files.ts                 # /files PUT (admin) + GET (public for browser-side Excel fetch)
│   │       ├── senderProfile.ts         # /sender-profile singleton GET/PUT
│   │       └── pi.ts                    # /pi CRUD + submit + submit-for-review + approve + reject + export-bundle
│   ├── lib/
│   │   ├── auth.ts                      # bcrypt hash/verify, jose JWT sign/verify, requireAdmin
│   │   ├── db.ts                        # drizzle wrapper + id() generator + first()/all() helpers
│   │   ├── piNumber.ts                  # nextPiNumber(env, language, date) — MAX(seq)+1 per date
│   │   ├── r2.ts                        # objectUrl/putObject/getObject (proxied through Worker, no presigning)
│   │   ├── schema.ts                    # Drizzle table definitions
│   │   ├── seed.ts                      # idempotent admin + senderProfile seed
│   │   └── types.ts                     # Env, AppUser, Variables, Role, Language
│   └── scheduled.ts                     # Cron handler — soft-archives APPROVED ZH PIs after 14 days
│
├── web/src/                             # React 18 + Vite + Tailwind SPA
│   ├── main.tsx, App.tsx                # Router + AuthProvider mounting
│   ├── types.ts                         # Strict shared types: Pi, PiItem, Product, ProductField, FieldValue, …
│   ├── api/client.ts                    # axios instance + JWT interceptor + 401 → logout
│   ├── auth/                            # AuthContext, ProtectedRoute, AdminRoute
│   ├── components/
│   │   ├── Form.tsx                     # Field, Section, ErrorText — generic form primitives
│   │   └── Layout.tsx                   # Top-bar shell with module nav + sign-out
│   ├── pages/                           # One file per route — orchestrators only, no inline business logic
│   │   ├── Login.tsx, Home.tsx
│   │   ├── PiPage.tsx                   # Both EN and ZH PI pages (language prop) — composes pi/* modules
│   │   ├── Products.tsx                 # Composes products/* modules
│   │   ├── ReviewPage.tsx               # Admin ZH PI review queue
│   │   ├── Permissions.tsx              # User/role admin
│   │   ├── Templates.tsx                # Excel header template management
│   │   └── Contracts.tsx                # Contract template upload/download
│   ├── pi/                              # PI page domain — shared by EN and ZH PI flows
│   │   ├── modelRule.ts                 # ★ Shared: ModelRule type, normalizeRule, buildGeneratedModel,
│   │   │                                #   getMeta/setMeta for prefix/segments, applyModelRule, upsertField,
│   │   │                                #   modelLabel/orderMeaningLabel, modelRuleKey, optionPath
│   │   ├── fieldValues.ts               # visibleFieldValues, getMeta("currency"), setMeta
│   │   ├── format.ts                    # currencies list, formatCurrency, formatNumber, parseNumericInput
│   │   ├── labels.ts                    # piDisplayName, productOptionLabel, labelForCustomer/Sender, senderDefaultsFrom
│   │   ├── LineItem.tsx                 # Single line item row + nested FieldValueInput
│   │   ├── ModelBuilder.tsx             # Prefix/segment selectors that produce generated model code
│   │   ├── OptionSetModal.tsx           # "Manage" modal for incoterm/customerSource/customerType lists
│   │   └── SelectWithManage.tsx         # Select + admin-only "Manage" button combo
│   ├── products/                        # Product admin page domain
│   │   ├── productFields.ts             # blankProduct/blankField, parseField, normalizeField, resequence,
│   │   │                                #   sameField (dirty check), productPayload, optionSummary
│   │   ├── modelRuleAdmin.ts            # loadProductModelRule + parse/format model-options textarea
│   │   ├── FieldRow.tsx                 # Editable spec-field row (label/type/options/default/sort)
│   │   ├── OptionsModal.tsx             # Dropdown options + default-value picker
│   │   ├── ModelRuleEditor.tsx          # ZH model-builder rule editor (prefixes, segments, options)
│   │   └── FilePicker.tsx               # Sub-template uploader
│   └── excel/                           # Browser-side Excel stitching (ExcelJS)
│       ├── exportPi.ts                  # exportPi() orchestrator + writeLineItem + appendSubTemplate + writeTotalsRow
│       └── tokens.ts                    # tokensFor (header), fieldTokens, itemTokens, generatedModel,
│                                        #   replaceTokens/replaceValue, currencyFormat, formatNumber
│
└── migrations/                          # Hand-written SQL applied via wrangler d1 migrations apply
    ├── 0000_init.sql                    # users, categories, products, productFields, productTemplates,
    │                                    #   pi, piItems, piReviewEvents, contractTemplates, excelTemplates, senderProfile
    ├── 0001_reviewer_options.sql        # ALTER pi ADD assignedToId + CREATE TABLE appOptions
    └── 0002_pi_sender_requirements.sql  # ALTER pi ADD senderCorp/senderAddress/senderFrom/senderPhone/senderEmail/otherRequirements
```

### Module-boundary principles enforced by this layout

1. **Pages are orchestrators, not implementations.** A page file (`pages/*.tsx`) wires API calls and state, then composes components from its domain folder (`pi/` or `products/`). Business logic, model-rule math, and reusable UI live in the domain folders.
2. **One folder per business domain, not per file type.** `pi/` holds *everything* the PI flow needs (UI, helpers, types). Avoids the dead-end of `helpers/` / `utils/` / `widgets/` god-folders.
3. **Shared logic lives at the lowest common ancestor.** `pi/modelRule.ts` is consumed by `pages/PiPage.tsx`, `pages/Products.tsx` (via `products/modelRuleAdmin.ts`), and `excel/exportPi.ts` (via its own `excel/tokens.ts` for the export-time variant) — same type definitions, no drift.
4. **API routes mirror frontend domains.** Each `functions/api/routes/*.ts` is a self-contained sub-Hono `app` exporting one named binding; the entry file is pure composition (`app.route("/", subApp)`). New endpoints go into the matching module, not the entry.
5. **The `_shared.ts` convention.** Helpers consumed by sibling files in the same folder live in `_shared.ts` (underscore prefix sorts it first and signals "internal to this folder"). `createApp()` ensures every sub-app shares the same `<{ Bindings, Variables }>` generic without each file restating it.
6. **No file exceeds ~340 lines today.** Anything growing past that is a signal to split — extract sub-components, extract pure helpers, or split the route file by resource.

### Where to put a new feature (decision tree)

- **A new API endpoint** → does it belong to an existing resource? add to `functions/api/routes/<resource>.ts`. New resource? new file + one line in `[[path]].ts`.
- **New UI on an existing page** → add a component file in the matching domain folder (`pi/` or `products/`); import it from the page. Don't grow the page file.
- **New helper used by 2+ files in the same domain** → new file in that domain folder.
- **New helper used across domains (e.g. PI page + export)** → put it where the *primary* consumer lives and import from siblings (e.g. model-rule logic lives in `pi/` because that's its conceptual home; export-time variant lives next to the export code).
- **New DB column** → new numbered migration in `migrations/`; update `web/src/types.ts` Pi/PiItem/etc. and the matching route's INSERT/UPDATE bindings.

## Data Model (`functions/lib/schema.ts`, Drizzle SQLite)

### users
`{ id, username (unique), passwordHash, displayName, role: 'ADMIN'|'USER', createdAt }`
Multiple ADMINs supported. Last-admin guard prevents demoting/deleting the only ADMIN.

### categories
`{ id, code (unique), nameEn, nameZh }`

### products
`{ id, code (unique), nameEn, nameZh, categoryId → categories.id, status: 'ACTIVE'|'DISCONTINUED' }`
**No `excelTemplateKey` on the product itself** — moved to a join table because templates are now per-language.

### productTemplates (NEW — per-language sub-templates)
`{ id, productId (cascade), language: 'EN'|'ZH', r2Key, uploadedById, uploadedAt }`
Unique on `(productId, language)`. A product can have an EN sub-template, a ZH sub-template, both, or neither.

### productFields (split by language)
`{ id, productId (cascade), language: 'EN'|'ZH', label, fieldType: 'TEXT'|'DROPDOWN', options? (JSON string[]), defaultValue?, sortOrder }`
**Two independent lists per product**, distinguished by `language`. Admin maintains the EN list and ZH list separately on the Product Edit page (two tabs). The EN field list is rendered on PI English; the ZH field list is rendered on PI Chinese. They can have different field counts and different fields entirely.

### pi
Common columns:
`{ id, language: 'EN'|'ZH', piNo (unique), status, date, customerCompany, customerContact?, customerEmail?, customerPhone?, customerCountry?, customerAddress?, createdById, createdAt, updatedAt, archivedAt? }`

Status enum:
- `'DRAFT' | 'SUBMITTED'` for **EN PIs** (sales submits = locks; can export Excel themselves).
- `'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED'` for **ZH PIs** (approval workflow).

EN-only header columns (nullable):
`validUntil, incoterm, shipmentMode, paymentTerm`

ZH-only header columns (nullable):
`productionOrderNo` (生产令号), `customerSource` (客户来源), `customerType` (客户类型), `deliveryDate` (交期)

`archivedAt` is set by the cron janitor 14 days after `APPROVED` (ZH PIs only); archived rows are hidden from default listings but the row stays so its `piNo` sequence position is preserved.

### piItems
`{ id, piId (cascade), productId, quantity, unitPrice, discountPct, fieldValues (JSON snapshot), sortOrder }`
`fieldValues` is captured at PI time from the appropriate language field list, so later product edits don't mutate historical PIs. Shape: `[{label, value, fieldType, sortOrder}]`.

### piReviewEvents (NEW — audit trail for ZH PI approval)
`{ id, piId (cascade), actorId, action: 'SUBMITTED'|'APPROVED'|'REJECTED', note?, createdAt }`
Powers the review history shown on the PiReview page.

### contractTemplates
`{ id, name, language: 'EN'|'ZH'|'BOTH', r2Key, size, uploadedById, uploadedAt }`

### excelTemplates (PI header templates — distinct from per-product sub-templates)
`{ id, language (unique: 'EN'|'ZH'), r2Key, anchorCellName, uploadedById, uploadedAt }`
One header template per language (the document skeleton with `${piNo}`, `${customer.company}`, etc., and the `PRODUCTS_START` defined-name anchor).

### senderProfile
`{ id (singleton, always 1), corp, address, fromName, phone, email }`

### PI numbering
Spec format `INJET20060-IT-YYYYMMDD<seq>`. Generated server-side: `MAX(seq)+1` for that date, computed in a single D1 transaction inside `lib/piNumber.ts`. Archived rows are still counted for sequence purposes.

## API Routes (Hono, all under `/api`, JWT required except `/auth/login`)

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/auth/login` | public | `{token, user}` |
| GET | `/auth/me` | any | |
| GET/POST/PATCH/DELETE | `/users` | ADMIN | last-admin guard on delete/demote; PATCH role to ADMIN promotes |
| GET/POST/PATCH/DELETE | `/categories` | GET any, write ADMIN | |
| GET/POST/PATCH/DELETE | `/products` | GET any, write ADMIN | |
| GET/POST/PATCH/DELETE | `/products/:id/fields?language=EN\|ZH` | GET any, write ADMIN | bilingual lists, queried by language |
| POST | `/products/:id/template/:lang/upload-url` | ADMIN | presigned R2 PUT URL + final key (lang ∈ EN, ZH) |
| POST | `/products/:id/template/:lang/commit` | ADMIN | upserts row in `productTemplates` |
| DELETE | `/products/:id/template/:lang` | ADMIN | deletes R2 object + row |
| GET/POST/PATCH/DELETE | `/pi` | any | non-admins scoped to their own PIs; ADMIN sees all |
| **POST** | **`/pi/:id/submit-for-review`** | **author** | **ZH PI only; status DRAFT → PENDING_REVIEW; logs piReviewEvents** |
| **GET** | **`/pi/review-queue`** | **ADMIN** | **list of ZH PIs with status=PENDING_REVIEW** |
| **POST** | **`/pi/:id/approve`** | **ADMIN** | **ZH PI only; PENDING_REVIEW → APPROVED; logs event** |
| **POST** | **`/pi/:id/reject`** | **ADMIN** | **ZH PI only; PENDING_REVIEW → REJECTED with `note`; logs event** |
| GET | `/pi/:id/export-bundle` | EN: any author / ZH: ADMIN only | returns `{ pi, items, sender, excelTemplateUrl, productTemplateUrls: {productId: url} }` — all R2 URLs presigned ~5 min |
| GET/POST/DELETE | `/contract-templates` | GET any, write ADMIN | POST returns presigned PUT URL |
| GET | `/contract-templates/:id/download-url` | any | presigned GET URL |
| GET/POST/DELETE | `/excel-templates` | ADMIN | per-language header template upload pattern |
| GET/PUT | `/sender-profile` | GET any, write ADMIN | |

Authorization rules for ZH PI export: only ADMIN can hit `/pi/:id/export-bundle` for a ZH PI in `APPROVED` state. Sales staff never see the Export Excel button on ZH PI; they see "Send to Admin" instead.

## Cron Janitor (`functions/scheduled.ts`)

Cron expression: `0 3 * * *` (daily at 03:00 UTC) declared in `wrangler.toml` `[[triggers]]`.

Logic (single D1 transaction):
```
UPDATE pi
SET archivedAt = CURRENT_TIMESTAMP
WHERE language = 'ZH'
  AND status = 'APPROVED'
  AND archivedAt IS NULL
  AND (
    SELECT MAX(createdAt) FROM piReviewEvents
    WHERE piId = pi.id AND action = 'APPROVED'
  ) < datetime('now', '-14 days');
```

Archived PIs are excluded from default listings (`WHERE archivedAt IS NULL`) but the row and its `piNo` are retained so PI sequence numbering stays monotonic. An admin-only `?includeArchived=1` query param can resurface them for audit.

No separate cache layer is needed — D1 is the single source of truth, so "cleanup the cache" means cleaning archived approved PIs from D1.

## Excel Export — Client-Side, Per-Language Templates

**File**: `web/src/excel/exportPi.ts`

Triggered by:
- **EN PI**: "Export Excel" button on `PiEnglishPage` (any author).
- **ZH PI**: "Download Excel" button on `PiReviewPage` (Admin only, after status = APPROVED).

Steps:
1. Fetch `/api/pi/:id/export-bundle` → `{ pi, items, sender, excelTemplateUrl, productTemplateUrls }`.
   - `excelTemplateUrl` is the EN or ZH header template depending on `pi.language`.
   - `productTemplateUrls` is keyed `{ productId: url }`, where each URL points to the EN or ZH per-product sub-template depending on `pi.language` (the Worker resolves which sub-template to mint a URL for).
2. Fetch `excelTemplateUrl` as ArrayBuffer; `await new ExcelJS.Workbook().xlsx.load(buf)`.
3. **Header substitution**: walk every cell on sheet 1; if string, replace tokens (mutate `cell.value` only to preserve style):
   - **EN tokens**: `${piNo}`, `${date}`, `${validUntil}`, `${incoterm}`, `${shipmentMode}`, `${paymentTerm}`, `${customer.company|contact|email|phone|country|address}`, `${sender.corp|address|from|phone|email}`.
   - **ZH tokens**: `${piNo}`, `${date}`, `${productionOrderNo}`, `${customerSource}`, `${customerType}`, `${deliveryDate}`, `${customer.*}`, `${sender.*}`.
4. **Anchor lookup**: `workbook.definedNames.getRanges(template.anchorCellName)` for start row/col. Fallback: scan for the literal `${PRODUCTS_START}` token.
5. **Line items**: for each `piItem` in `sortOrder`:
   - Insert a row at `currentRow` with `[Product name, Product code, qty, unit price, disc%, =qty*price*(1-disc/100)]`. Use EN names for EN PI, ZH names for ZH PI.
   - If `productTemplateUrls[productId]` exists, fetch + load that sub-template, copy its used range below the line row (cell-by-cell value/style copy, replay merges). Substitute `${field.<label>}` tokens against `piItem.fieldValues` (which were captured from the matching language list at PI time).
   - Advance `currentRow` past the inserted block.
6. Append a totals row using `SUM` over the line-item Amount column.
7. `const buf = await workbook.xlsx.writeBuffer(); saveAs(new Blob([buf]), `${pi.piNo}.xlsx`);`

**Admin authoring docs (in README):**
- Add a defined name `PRODUCTS_START` on the cell that should hold the first product row.
- Use `${...}` tokens for header fields; allowed tokens documented per language.
- Per-product sub-templates use `${field.<label>}` matching the labels in the corresponding language's field list.

## Auth & Permissions

- `bcryptjs` hashing (10 rounds); JWT via `jose.SignJWT` HS256 with `JWT_SECRET` (Pages secret, set via `wrangler pages secret put`).
- `requireAuth` and `requireAdmin` Hono middleware; SPA `ProtectedRoute` + `AdminRoute` mirror them.
- **Multiple admins**: PermissionsPage has a role dropdown (USER ↔ ADMIN) for every user; promoting another user to ADMIN gives them identical access. Last-admin guard on demote/delete.
- **Seed** (`functions/lib/seed.ts`): idempotent — runs on first request when `users` table is empty, creates `admin` / `Admin@123` Master Admin and the singleton `senderProfile` row. README directs the user to change the password immediately. A `wrangler d1 execute` seed script is also provided for manual init.

## UI Pages

All pages share a `Layout` with top header (logo left, bell + user chip + Sign Out top-right per screenshot). Tailwind theme: green primary (`#16a34a`), purple accent (`#7c3aed`), rounded-2xl cards, soft shadows.

- **LoginPage** — username + password, green "Sign In", "Welcome back" heading.
- **HomePage** — greeting card, then "Available Modules" grid (8 module cards). **No stats tiles.** For ADMIN, an extra card "Pending Reviews" surfaces ZH PIs awaiting approval (with a count badge); hidden for USER. Cards hidden for non-admins where applicable: Permission Management, Product Management, Excel Template Settings, Contract Templates upload (download still visible).
- **ProductsPage / ProductEditPage** — category tab bar, product table (Code, Name EN/ZH, Category, Status, Actions). Add/Edit modal contains:
  - Basic info (code, names, category, status).
  - **Two tabs for spec fields**: "English Fields" and "Chinese Fields" — each tab is a separate `FieldEditor` instance for the corresponding `productFields` list (independent lists). Each field row: label, type (TEXT/DROPDOWN), options list, default value, sortOrder.
  - **Two upload widgets for sub-templates**: "EN sub-template (.xlsx)" and "ZH sub-template (.xlsx)" — each uses a presigned PUT.
- **PiEnglishPage** — header card with **Date, Valid Until, PI No (auto), Incoterm, Shipment Mode, Payment Term**. Customer Information card. Products / Line Items card with `+ Add Product` (renders that product's **EN field list** inline). Top-bar buttons: Save Draft, Print (`window.print`), Submit Order, **Export Excel** (calls `web/src/excel/exportPi.ts` directly — no admin gating).
- **PiChinesePage** — header card with **Date, PI No (auto), 生产令号 (productionOrderNo), 客户来源 (customerSource), 客户类型 (customerType), 交期 (deliveryDate)** — different from EN. Customer Information card. Products / Line Items card with `+ Add Product` (renders that product's **ZH field list** inline). Top-bar buttons depend on status:
  - `DRAFT`: Save Draft, Print, **Send to Admin** (POST `/pi/:id/submit-for-review`). No Export Excel for sales.
  - `PENDING_REVIEW`: read-only banner "Awaiting admin review"; sales can recall to DRAFT.
  - `REJECTED`: shows admin's rejection note, returns to editable DRAFT-like state with a Resubmit button.
  - `APPROVED`: read-only with banner "Approved by {admin}"; sales sees it but can't edit.
- **PiReviewPage (NEW, ADMIN)** — list view at `/pi/review-queue` showing all `PENDING_REVIEW` ZH PIs (PI No, customer, created by, submitted at). Click row → detail view rendering the same ZH PI form in read-only mode + a Review panel: textarea for note, **Approve** button, **Reject** button, plus a timeline of `piReviewEvents`. Once Approved, an inline **Download Excel** button appears (calls `exportPi.ts` with the ZH template).
- **ContractTemplatesPage** — drag-drop upload (presigned PUT), list with name/language/size/uploader/date, download (presigned GET) + (admin) delete.
- **PermissionsPage** (admin) — user list with **role dropdown (USER ↔ ADMIN)** and Add User modal; promoting to ADMIN gives full access. Delete with last-admin guard.
- **ExcelTemplatesPage** (admin) — one row per language (EN, ZH); upload `.xlsx`, set anchor cell name (default `PRODUCTS_START`), replace/delete. Inline help listing the allowed tokens **per language**.
- **SenderProfilePage** (admin) — singleton form for company corp/address/from/phone/email shown in the PI header.

## Critical Files to Create

- `package.json` (workspaces + `dev`/`build`/`deploy`/`db:*` scripts), `wrangler.toml` (with `[[triggers]] crons = ["0 3 * * *"]`), `drizzle.config.ts`, `tsconfig.base.json`, `.gitignore`, `README.md`
- `migrations/0000_init.sql` (drizzle-kit generated)
- `functions/api/[[path]].ts`, `functions/_middleware.ts`, `functions/scheduled.ts`
- `functions/lib/{db,schema,auth,r2,seed,piNumber}.ts`
- `functions/routes/{auth,users,categories,products,productFields,productTemplates,pi,piReview,contracts,excelTemplates,senderProfile}.ts`
- `web/package.json`, `web/vite.config.ts`, `web/tailwind.config.js`, `web/index.html`
- `web/src/main.tsx`, `App.tsx`, `router.tsx`
- `web/src/api/client.ts`
- `web/src/auth/{AuthContext,ProtectedRoute,AdminRoute}.tsx`
- `web/src/components/{Layout,Header,Card,Modal,FieldEditor,FileDrop,LineItemRow}.tsx`
- `web/src/excel/exportPi.ts`
- `web/src/pages/*` (11 pages: Login, Home, Products, ProductEdit, PiEnglish, PiChinese, **PiReview**, ContractTemplates, Permissions, ExcelTemplates, SenderProfile)

## Verification (end-to-end)

**Local (`wrangler pages dev`):**
1. `npm install` → `npm run db:generate` → `npm run db:migrate:local` → `npm run dev`. SPA at `http://localhost:8788`, `/api/*` served by Pages Functions.
2. Log in as `admin` / `Admin@123` (lazy-seeded). Confirm Home shows module cards **without** stats tiles.
3. **Sender Profile**: fill EVMAX corp/address/etc.
4. **Product Mgmt**: create category "AC Charger / 交流充电桩"; create product `EVMAX-AC7`. In the **English Fields** tab add ~6 fields (Version, Cable Configuration, OCPP Protocol…); in the **Chinese Fields** tab add a different set (e.g. 版本、电缆配置、启动方式、停止按键、显示语言、品牌定制) — confirm they're independent.
5. Upload **EN sub-template** and **ZH sub-template** for `EVMAX-AC7` (different layouts). Confirm both land in R2 emulation under `product-templates/{productId}/en.xlsx` and `.../zh.xlsx`.
6. **Excel Templates**: upload an English PI header `.xlsx` with defined name `PRODUCTS_START`; upload a Chinese PI header `.xlsx` with the ZH header tokens (`${productionOrderNo}` etc.).
7. **Contract Templates**: upload sample contract, download via presigned URL, delete.
8. **PI EN**: create new English PI, fill header (Date, Valid Until, Incoterm, Shipment, Payment), customer info, add 2 line items. **Export Excel** directly — open the file, verify EN tokens substituted, EN sub-templates stamped per line, totals correct.
9. **PI ZH (workflow)**:
   - Create new Chinese PI as `admin` (or as a sales user). Confirm header card shows 生产令号 / 客户来源 / 客户类型 / 交期 (and **not** Incoterm/Shipment/Payment).
   - Add 2 line items — confirm the ZH field list renders, distinct from EN.
   - Save Draft. Confirm there's **no Export Excel button**.
   - Click **Send to Admin** → status → `PENDING_REVIEW`.
10. **Review queue**: as ADMIN, open `/pi/review-queue`, see the pending PI. Open it: read-only ZH form + Review panel. Click **Reject** with note "改一下交期" → status `REJECTED`, sales sees note and can resubmit.
11. Resubmit → APPROVE → admin sees inline **Download Excel** button → downloads → open file → ZH header tokens substituted, ZH sub-templates stamped, ZH product names used.
12. **Permissions**: create user `sales1` / role USER; verify Home hides admin-only modules and `/products`, `/permissions`, `/excel-templates`, `/pi/review-queue` return 403. Sales1 can create+send ZH PIs but cannot export. Promote `sales1` to ADMIN; confirm they now see review queue and admin modules — **multiple admins coexist**.
13. **Last-admin guard**: try to demote the only remaining ADMIN → 400 with clear error.
14. **Janitor**: manually invoke the cron handler via `wrangler pages dev --execute-scheduled` (or call the scheduled endpoint), with a backdated `piReviewEvents.createdAt` for an APPROVED PI; confirm `archivedAt` gets set and the PI disappears from default listings but remains queryable with `?includeArchived=1`. Confirm `piNo` for that date is **not** reused on the next ZH PI.

**Deploy (Cloudflare):**
15. `wrangler d1 create sales-portal-db` → paste binding → `wrangler d1 migrations apply DB --remote`.
16. `wrangler r2 bucket create sales-portal-files`.
17. `wrangler pages secret put JWT_SECRET` (random 32 bytes).
18. `npm run build && wrangler pages deploy web/dist`.
19. Smoke-test deployed URL: log in, upload templates, run the full ZH approval flow, confirm Workers analytics show CPU well under 10 ms/req, verify the daily cron fires at 03:00 UTC.

## Out of Scope (explicit non-goals for this PR)

- Real email/notifications (no email when admin needs to review — admin checks the in-app review queue), PDF generation, multi-tenant org separation, i18n beyond the EN/ZH content fields already modeled (UI strings stay English).
- English-PI approval workflow (EN PIs keep simple Draft/Submitted; sales export Excel directly).
- Server-side Excel rendering (intentionally moved to browser to fit free-tier Workers CPU budget).
- Hard-deletion of archived PIs (we soft-archive only, to preserve PI sequence integrity).
