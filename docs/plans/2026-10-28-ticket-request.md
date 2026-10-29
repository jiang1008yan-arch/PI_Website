# Ticket request lifecycle: one writer for feishuDrafts

Candidate 3 of [the architecture review of 2026-10-28](../architecture-review-2026-10-28.html).
Constraint: **existing behaviour stays the same.** Every visible change is listed under
"Separate decisions" and is out of scope here.

## Problem

A ticket request (and Add to ticket, and a device alert) lives in `feishuDrafts` +
`feishuDraftItems`. `functions/lib/feishu/drafts.ts` held part of its lifecycle, but the two
tables were written from four modules:

- `api/routes/feishu.ts`:
  - expiry when a button is pressed (`refuseExpired`), discarding
  - claiming a device alert, binding the card
  - the claim → create → link chain of "Create ticket"
  - the claim/release of "Save to ticket"
- `lib/feishu/intake.ts`:
  - the card id, the suggested group, voice transcripts
  - the AI's suggestion, when the form was opened, the SN found in the material
- `lib/deviceMonitor.ts`: opening a device alert and binding its card.

Expiry was written two ways (`COALESCE(expiredAt, CURRENT_TIMESTAMP)` and
`expiredAt = ? WHERE expiredAt IS NULL`). The open-request guard lived in the route and answered
with toasts, so it could only be tested through the card callback.

## Decisions

1. **One writer.** `drafts.ts` becomes `functions/lib/feishu/ticketRequest.ts` (`git mv`), the
   only writer of `feishuDrafts` and `feishuDraftItems`, card id and AI results included.
   - `intake.ts` keeps reading messages, running the AI and drawing cards.
   - The route keeps only verification and dispatch.
   - Who a request belongs to (`FeishuPerson`, `requesterKey`, `ownsDraft`) moves into
     ticketRequest with it.
2. **Create from a request** stays claim → create → link, with a release when creating fails.
   This is now `createTicketFromRequest(db, draftId, create)`, and "Save to ticket" is
   `saveToTicket(db, draft, save)`.
   - Both return `null` when already claimed.
   - Ticket numbers and toasts are unchanged.
3. **Open request guard.** `openRequestFor(db, draftId, person, cardMessageId, now, opts)`
   returns the request, or one of these reasons:
   - `gone`, `created`, `discarded`, `unclaimed`
   - `notYours`, `inPrivate`, `expired`

   On `expired` the guard records expiry itself, with the same write as `expireDraft`. The two
   writes are equivalent, since both are UTC `YYYY-MM-DD HH:MM:SS` and the first value wins. The
   route keeps the toast text and greys the card out.
4. **Device alerts.**
   - `openDeviceAlert(db, alert, send, now)` inserts the request. It then sends the card through
     `send`, and binds the card and `deviceStatus.alertDraftId` in one batch. This mirrors the
     Ticket workflow, which writes `deviceStatus.alertTicketId` in its create batch.
   - `claimAlert(db, draftId, requestedBy, now)` returns `taken`, `busy` or `takenByOther`.
   - `deviceMonitor` keeps detection, the alert card and `saveState`.

## Tests

- Existing tests pass. The only change to them is the import path in `materials.test.ts` and
  `scheduled.int.test.ts`: no assertion changed, and there is no `drafts.ts` shim.
- New `functions/test/ticketRequest.int.test.ts` asserts only at the module interface, on a real
  local D1 from `test/harness.ts`. It covers:
  - The guard's reasons, and that expiry is recorded once.
  - Claim → create → link. The request reads `CREATING` while the ticket is created, and a
    second press creates nothing. A failed create releases the claim.
  - Save to ticket: saved once, released on failure.
  - `openDeviceAlert` with a fake `send`: the card and device link are written together, and
    there is no link when sending fails.
  - `claimAlert`: `taken`, `busy` and `takenByOther`.
- One writer, as a checklist: `grep -rn "feishuDrafts\|feishuDraftItems" functions` finds
  writes only in `ticketRequest.ts`.

## Rollout

Three steps on this branch. `npm test` and the server typecheck must pass after each step.

1. Rename the module, update imports, and add the CONTEXT.md section.
2. Move every write into ticketRequest, along with the guard, `claimAlert` and `openDeviceAlert`.
3. Add the new tests and this plan.

Commit locally only. No push and no PR until reviewed.

## Separate decisions (not in this change)

Continues the list in [the Ticket workflow plan](2026-10-28-ticket-workflow.md) (A–C).

- **D.** If the Worker stops after claiming a request (`ticketId = 'CREATING'`) and before the
  ticket is created, the request stays claimed for good. Every later press says "A ticket was
  already created for this", but no ticket exists. Possible fixes are a claim timestamp that
  expires, or a scheduled job that releases old `CREATING` claims.
  **Resolved 2026-10-29** with a claim that expires:
  - Migration `0022_request_claims.sql` adds `feishuDrafts.claimedAt`.
  - The Ticket workflow links the request inside the create batch, or the note batch for Save to
    ticket, guarded by `workflowGuard` so that the link only happens while the claim is still the
    caller's. This is the one documented exception to "ticketRequest is the only writer".
  - A claim older than 2 minutes (or one from before `claimedAt` existed) is open again.
  - Stopping after the batch leaves the request linked, so nothing is redone. A slow attempt whose
    claim was taken over gets a 409 and makes no second ticket. Its ticket number is skipped,
    which is the price of an edge case that needs a Worker running over 2 minutes.
  - Covered by the "claims left behind" tests in `ticketRequest.int.test.ts`.
- **E.** When an expired Add to ticket is found by a button press, the guard path shows the
  new-request expired card (`expiredDraftCard`). Its toast also says "nothing added for 6 hours",
  but Add to ticket expires after 30 minutes. The scheduled expiry correctly uses
  `addExpiredCard()`.
