# Domain context

Vocabulary used across this codebase. Keep these terms exact — drift creates ambiguity.

## Core entities

- **PI** (Proforma Invoice) — the central document. Each PI is one of two **languages**: `EN` or `ZH`. EN PIs are customer-facing; ZH PIs flow through review and translation before the equivalent customer document is exported.
- **Product** — catalog entry with bilingual names, per-language **dynamic fields**, and per-language Excel **sub-templates**.
- **Product field** — a label/type/options definition attached to a product for one language. Drives the line-item field set on a PI.
- **Line item** — one product on one PI, carrying quantity, unit price, discount, and a `fieldValues` array (product-field values + hidden `__`-prefixed meta fields like `__currency`). The wire format ships `fieldValues` as a JSON string; [`web/src/pi/piItemCodec.ts`](web/src/pi/piItemCodec.ts) is the sole parse seam on the client.
- **Sender profile** — singleton (id=1) holding the company's default sender details for EN PIs.
- **Excel template** — per-language workbook used to render approved PIs.

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
                                                            |
                                                       (edit, resubmit)
```

- **DRAFT** — editable by owner/admin. Auto-purged after 3 days idle.
- **SUBMITTED** — EN-only terminal-ish state; remains editable by owner/admin (EN has no lock).
- **PENDING_REVIEW** — ZH-only. **Locked for direct writes.** Admin reviewers edit in **review mode** (see below) and commit changes only via Approve.
- **APPROVED** — ZH only. Required before Excel export. Triggers visibility on the submitter's "Confirmed Received" view.
- **REJECTED** — ZH only. Editable again by owner/admin; carries `rejectionNote` and (optionally) `suggestedChanges` from the reviewer.

## Review workflow

ZH PIs in PENDING_REVIEW are claimed for review by an admin (`assignedToId`). The reviewer may edit the PI in place, but:

- **Review mode** — Edits live only in client-side React state. Direct `PATCH /pi/:id` is denied by `canPatchPi` for PENDING_REVIEW. Edits are committed only on **Approve** (carrying the new state + a diff) or recorded as **suggestedChanges** on **Reject**.
- **Diff format** — Client-computed via [`web/src/pi/piDiff.ts`](web/src/pi/piDiff.ts). Old-then-new pairs for changed header fields and modified items; added/removed item arrays. Stored as JSON in `piReviewEvents.note`.
- **`APPROVED_WITH_EDITS`** — Event action used when an approval carried a non-empty diff. Plain `APPROVED` means no edits were made.

## Authorization

All access checks for PI actions go through [`functions/lib/piAccess.ts`](functions/lib/piAccess.ts) — pure functions returning a `Verdict` (allowed, or `{ reason, status }`). Adding a new PI route means adding a new `canXPi` function and a row in the test table at [`functions/lib/piAccess.test.ts`](functions/lib/piAccess.test.ts). Do not write inline role/status checks in route handlers.
