# Domain context

Vocabulary used across this codebase. Keep these terms exact — drift creates ambiguity.

## Core entities

- **PI** (Proforma Invoice) — the central document. Each PI is one of two **languages**: `EN` or `ZH`. EN PIs are customer-facing; ZH PIs flow through review and translation before the equivalent customer document is exported.
- **Product** — catalog entry with bilingual names, per-language **dynamic fields**, and per-language Excel **sub-templates**.
- **Product field** — a label/type/options definition attached to a product for one language. Drives the line-item field set on a PI.
- **Line item** — one product on one PI, carrying quantity, unit price, discount, and a `fieldValues` array (product-field values + hidden `__`-prefixed meta fields like `__currency`). Two client seams sit over this array: [`web/src/pi/piItemCodec.ts`](web/src/pi/piItemCodec.ts) is the sole **parse** seam (JSON string ⇄ `FieldValue[]`), and [`web/src/pi/lineItemFields.ts`](web/src/pi/lineItemFields.ts) is the sole **field-semantics** seam — it owns the `__`-meta convention (`getMeta`/`setMeta`), `upsertField`/`visibleFields`, and the `fieldType:"TEXT", sortOrder:-1` stamp on synthesized fields. Do not read or write `fieldValues` by hand; go through these.
- **Generated model** — `Model` / `Model Lines` / `Order Code Meaning` are *derived* from a product's **model rule** plus the item's `__modelRule` / `__modelPrefix` / `__modelSegment:*` meta. [`web/src/pi/modelRule.ts`](web/src/pi/modelRule.ts) `buildGeneratedModel` is the single generator; both the editor and the Excel exporter reach it through `generatedModelFor(item)`. An explicitly-empty `__modelPrefix` yields no prefix (the `??` rule, covered by `modelRule.test.ts`).
- **Sender profile** — singleton (id=1) holding the company's default sender details for EN PIs.
- **Excel template** — per-language workbook used to render approved PIs.
- **Submitted snapshot** — an immutable JSON capture of a ZH PI's header + line items, frozen at `submit-for-review` time and stored on `pi.submittedSnapshot`. Lets the submitter see what they sent even after admin edits land on the PI row. Overwritten on each new submit-for-review; per-submission history lives in `piReviewEvents`.
- **PI number sequence** — per-date sequence state stored in `piNumberSequences`, independent from retained PI rows. This lets scheduled cleanup hard-delete old PIs without reusing PI numbers.
- **Production order number** — the factory order number a salesperson enters on a ZH PI. One PI has exactly one; it is the key that links a PI to after-sales tickets and devices. _Avoid_: order number, order no. (on tickets).

## Approval and revision

- **Presales confirmation** — the first approval step on a ZH PI, done by an ADMIN (the "recipient"), who may edit the PI while confirming. Shown in the UI as "Confirm Received". _Avoid_: review approval.
- **Commerce approval** — the second and final approval step, done by a COMMERCE user, who may approve or reject but never edit. A PI is **approved** only after this step.
- **Commerce** (`COMMERCE` role) — the business staff who give commerce approval and download the EN/ZH Excel files. Distinct from ADMIN; an ADMIN may never give commerce approval.
- **Revision** — a change to an already-approved PI pair (ZH + linked EN), started with a mandatory reason and sent through presales confirmation and commerce approval again. Numbered Rev 1, Rev 2, … under the same PI No.
- **Effective version** — the most recently approved content of a PI. While a revision is in progress the effective version stays the previous approved content; it is replaced only when the revision gets commerce approval.

## After-sales

- **Ticket** — one customer after-sales issue. Linked to an approved ZH PI through its production order number.
- **Device** — one physical unit delivered under a PI, identified by its **serial number (SN)**. An SN belongs to exactly one PI.
- **Fault type** — the after-sales-confirmed classification of what went wrong, chosen from a maintained list. Statistics count only confirmed fault types; the customer's self-reported problem type is reference only. _Avoid_: problem type (for the confirmed value).
- **Repeat fault** — the same fault type on the same catalog product reaching a configured count within a configured window. Judged per product across all its models, even though statistics list each model separately.
- **Ticket type** — what a ticket is about: Fault, Product request, or Question / other. Set by after-sales (AI may suggest it) and required before a ticket is resolved. Only Fault tickets carry a fault type.
- **Product request** — a ticket in which the customer asks for a new or changed product capability. Written once to the requirement pool.
- **Requirement pool** — the product managers' Feishu Bitable where product requests collect; they filter, export, assign and get notified there, not in this system.
- **Owner** — the after-sales (and sales) person responsible for a ticket. Whoever creates a ticket owns it; any after-sales can hand it over, and every change is logged on the ticket.
- **Weekly summary** — the Monday (9:00 Beijing) card in the after-sales group: last week's numbers and every open ticket by owner. Replaces a group message per ticket.
- **Update reminder** — one private message a day to an owner whose open tickets have gone 24 hours without an update.
- **Request expiry** — a Feishu "create a ticket?" request not submitted within 6 hours is greyed out; device-alert requests do not expire.
- **Lookup** — type-ahead over existing production orders (approved PIs), customer names (PIs and tickets) and registered SNs; picking one fills the related fields. _Avoid_: free-typing values the system already has.
- **Device status / device alert** — the latest ONLINE / OFFLINE / FAULT state per SN pushed by the charger backend; a fault, or offline for 2 hours, opens one alert per SN in the after-sales group until the device is back online.
- **Personal AI key** — a user's own Qwen or DeepSeek key, saved encrypted and used only for that user's AI suggestions. _Avoid_: a shared company key.

## PI status state machine

A PI moves through these statuses. Transitions are gated by language, ownership, and role — see [`functions/lib/piAccess.ts`](functions/lib/piAccess.ts).

```
              EN flow                            ZH flow

              DRAFT                              DRAFT  <──────────────┐
                |                                  |                   │
            (submit)                       (submit-for-review)         │
                |                                  |                   │
            SUBMITTED                       PENDING_REVIEW             │
                                                   |                   │
                                   presales confirmation (ADMIN)       │
                                          /                \           │
                                PENDING_COMMERCE        REJECTED ──────┤
                                          |                ^           │
                              commerce approval (COMMERCE) │           │
                                   /                \      │           │
                              APPROVED            reject ──┘           │
                                  │                                    │
                                  └──── start revision (reopens) ──────┘
```

- **DRAFT** — editable by owner/admin. Auto-purged after 3 days idle, unless it is a revision or an EN PI paired with a ZH PI that has left its draft.
- **SUBMITTED** — EN-only. Editable by owner/admin until its linked ZH PI is approved; then it is locked with it.
- **PENDING_REVIEW** — ZH-only, awaiting presales confirmation. **Locked for direct writes.** Admin reviewers edit in **review mode** (see below) and commit changes only via confirmation.
- **PENDING_COMMERCE** — ZH-only, awaiting commerce approval. Locked; commerce approves or rejects without editing.
- **APPROVED** — ZH only, after commerce approval. Required before Excel export by admins; commerce may also download while deciding. Kept three years after the latest commerce approval, then purged by the scheduled janitor.
- **REJECTED** — ZH only, by either step. Editable again by owner/admin; carries `rejectionNote` and (from presales only) `suggestedChanges`. Resubmitting restarts at presales confirmation.

## Review workflow

ZH PIs in PENDING_REVIEW are claimed for review by an admin (`assignedToId`). The reviewer may edit the PI in place, but:

- **Review mode** — Edits live only in client-side React state. Direct `PATCH /pi/:id` is denied by `canPatchPi` for PENDING_REVIEW. Edits are committed only on **Approve** (overwriting the PI row) or recorded as **suggestedChanges** on **Reject**.
- **Submitted snapshot vs live row** — On `submit-for-review`, the workflow freezes the current header + items into `pi.submittedSnapshot`. The submitter's view reads from the snapshot; the admin's view (and Excel export) reads from the live PI row. The two diverge after an approve-with-edits; the submitter can toggle between them.
- **Event log** — `piReviewEvents.action` records `SUBMITTED | APPROVED | REJECTED` only. "Approved with edits" is derived by comparing the snapshot against the current row, not stored as a distinct action.

## PI workflow

All state-changing operations on a PI — `submit`, `submitForReview`, `approve`, `reject`, `delete` — flow through [`functions/lib/piWorkflow.ts`](functions/lib/piWorkflow.ts). The workflow module is the **only** writer to `pi.status`, `pi.rejectionNote`, `pi.assignedToId`, `pi.submittedSnapshot`, and `piReviewEvents`. The `piItems` **wire-encoding** (INSERT columns, numeric `Number()` coercion, `fieldValues` JSON) is owned by [`functions/lib/piItems.ts`](functions/lib/piItems.ts) — the sole builder of item write statements, returning `D1PreparedStatement[]` that both the workflow runner (folded into its atomic transition batch) and the route handlers (`saveItems`/`replaceItems`) compose into their own batches. Route handlers in [`functions/api/routes/pi.ts`](functions/api/routes/pi.ts) only parse the request, call the matching `canXPi`, dispatch to the workflow, and return. `PATCH /pi/:id` is forbidden from touching `status`, `rejectionNote`, or `assignedToId` — those columns are workflow-owned. The 3-day DRAFT auto-purge is garbage collection, not a workflow transition.

## Authorization

All access checks for PI actions go through [`functions/lib/piAccess.ts`](functions/lib/piAccess.ts) — pure functions returning a `Verdict` (allowed, or `{ reason, status }`). Adding a new PI route means adding a new `canXPi` function and a row in the test table at [`functions/lib/piAccess.test.ts`](functions/lib/piAccess.test.ts). Do not write inline role/status checks in route handlers.

The **status → capability rules** themselves (which statuses are directly writable, when an admin is in review-edit mode, when a PI is deletable) live in one bundle-neutral kernel: [`shared/piCapabilities.ts`](shared/piCapabilities.ts) — pure boolean predicates over `(role, language, status)`, no DOM/Workers/env deps, included by both the `functions` and `web` tsconfigs. The server's `piAccess` composes them with **ownership** and the `Verdict`/HTTP-status mapping; the client ([`web/src/pi/usePiEditor.ts`](web/src/pi/usePiEditor.ts)) consumes the same predicates raw for UI gating (`locked` / `canEditPendingZh` / delete guard) and relies on read-gating for ownership. Edit a capability rule there once, not in two bundles.
