# Domain context

Vocabulary used across this codebase. Keep these terms exact — drift creates ambiguity.

## Core entities

- **PI** (Proforma Invoice) — the central document. Each PI is one of two **languages**: `EN` or `ZH`. EN PIs are customer-facing; ZH PIs flow through review and translation before the equivalent customer document is exported.
- **Product** — catalog entry with bilingual names, per-language **dynamic fields**, and per-language Excel **sub-templates**.
- **Product field** — a label/type/options definition attached to a product for one language. Drives the line-item field set on a PI.
- **Line item** — one product on one PI, carrying quantity, unit price, discount, and a `fieldValues` array (product-field values + hidden `__`-prefixed meta fields like `__currency`). The wire format ships `fieldValues` as a JSON string; [`web/src/pi/piItemCodec.ts`](web/src/pi/piItemCodec.ts) is the sole parse seam on the client.
- **Sender profile** — singleton (id=1) holding the company's default sender details for EN PIs.
- **Excel template** — per-language workbook used to render approved PIs.
- **Submitted snapshot** — an immutable JSON capture of a ZH PI's header + line items, frozen at `submit-for-review` time and stored on `pi.submittedSnapshot`. Lets the submitter see what they sent even after admin edits land on the PI row. Overwritten on each new submit-for-review; per-submission history lives in `piReviewEvents`.

## PI status state machine

A PI moves through these statuses. Transitions are gated by language, ownership, and role — see [`functions/lib/piAccess.ts`](functions/lib/piAccess.ts).

```
              EN flow                            ZH flow

              DRAFT                              DRAFT
                |                                  |
            (submit)                       (submit-for-review)
                |                                  |
            SUBMITTED                       PENDING_REVIEW
                                                   |
                                       admin: approve / reject
                                            /              \
                                       APPROVED         REJECTED
```

- **DRAFT** — editable by owner/admin. Auto-purged after 3 days idle.
- **SUBMITTED** — EN-only terminal-ish state; remains editable by owner/admin (EN has no lock).
- **PENDING_REVIEW** — ZH-only. **Locked for direct writes.** Admin reviewers edit in **review mode** (see below) and commit changes only via Approve.
- **APPROVED** — ZH only. Required before Excel export. Triggers visibility on the submitter's "Confirmed Received" view.
- **REJECTED** — ZH only. Editable again by owner/admin; carries `rejectionNote` and (optionally) `suggestedChanges` from the reviewer.

## Review workflow

ZH PIs in PENDING_REVIEW are claimed for review by an admin (`assignedToId`). The reviewer may edit the PI in place, but:

- **Review mode** — Edits live only in client-side React state. Direct `PATCH /pi/:id` is denied by `canPatchPi` for PENDING_REVIEW. Edits are committed only on **Approve** (overwriting the PI row) or recorded as **suggestedChanges** on **Reject**.
- **Submitted snapshot vs live row** — On `submit-for-review`, the workflow freezes the current header + items into `pi.submittedSnapshot`. The submitter's view reads from the snapshot; the admin's view (and Excel export) reads from the live PI row. The two diverge after an approve-with-edits; the submitter can toggle between them.
- **Event log** — `piReviewEvents.action` records `SUBMITTED | APPROVED | REJECTED` only. "Approved with edits" is derived by comparing the snapshot against the current row, not stored as a distinct action.

## PI workflow

All state-changing operations on a PI — `submit`, `submitForReview`, `approve`, `reject`, `delete` — flow through [`functions/lib/piWorkflow.ts`](functions/lib/piWorkflow.ts). The workflow module is the **only** writer to `pi.status`, `pi.rejectionNote`, `pi.assignedToId`, `pi.submittedSnapshot`, and `piReviewEvents`. Route handlers in [`functions/api/routes/pi.ts`](functions/api/routes/pi.ts) only parse the request, call the matching `canXPi`, dispatch to the workflow, and return. `PATCH /pi/:id` is forbidden from touching `status`, `rejectionNote`, or `assignedToId` — those columns are workflow-owned. The 3-day DRAFT auto-purge is garbage collection, not a workflow transition.

## Authorization

All access checks for PI actions go through [`functions/lib/piAccess.ts`](functions/lib/piAccess.ts) — pure functions returning a `Verdict` (allowed, or `{ reason, status }`). Adding a new PI route means adding a new `canXPi` function and a row in the test table at [`functions/lib/piAccess.test.ts`](functions/lib/piAccess.test.ts). Do not write inline role/status checks in route handlers.
