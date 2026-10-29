# Ticket workflow: one writer for ticket changes

Candidate 1 of [the architecture review of 2026-10-28](../architecture-review-2026-10-28.html).
Constraint: **existing behaviour stays the same.** Every visible change is listed under
"Separate decisions" and is out of scope here.

## Problem

`functions/lib/ticketService.ts` is meant to be the only writer of tickets, but other code
writes tickets directly, and its writes are not atomic:

- `PATCH /tickets/:id/product` runs its own `UPDATE tickets` (`routes/tickets.ts:270`).
- Feishu bookkeeping columns are written from `routes/feishu.ts:356`, `feishu/sync.ts:134,184`
  and `feishu/digest.ts:68`.
- `createTicket` inserts the ticket and its first note with two separate `.run()` calls.
  `takeTicket` runs two batches.
- The Feishu "update" card action changes status and adds a note as two separate writes.
- Confirming a ticket request in Feishu (`confirmDraft`) chains 7 or more separate writes.
- Routes build the Feishu change events themselves (`TicketChange`).

## Decisions

1. **Scope.** The Ticket workflow writes the ticket business columns and `ticketUpdates`:
   status, owners, customer, product/model/SN, type, fault type, summary and attachments rows.
   - Feishu bookkeeping columns (`feishuCardMessageId`, `feishuCardOwnerId`, `bitableRecordId`,
     `lastRemindedAt`) are written only through one function in `feishu/sync.ts`.
   - Exception: when a Feishu request card becomes the ticket card, that card binding goes into
     the create batch.
   - Likewise, a device-alert source (`deviceStatus.alertTicketId`) is written in the create batch.
2. **Interface: verb functions.** Each function loads, checks, and commits one D1 batch. There is
   no plan/run split, because the ticket rules need database reads (fault type options, known SNs,
   user names).
   - `createTicket` also accepts an optional ticket type, fault type, stored files, card binding
     and alert source.
   - New `updateProgress(user, id, { status?, note? })` replaces the status call plus note call
     in the Feishu "update" action.
   - `take` becomes one batch.
3. **Concurrency.** Status changes carry an expected-state guard, reusing `workflowGuard`
   (migration 0019), so the slower of two simultaneous actions gets a conflict. This covers
   `changeStatus`, the status part of `updateProgress`, and `take`. A new ticket always starts as
   NEW. All other edits stay last-write-wins.
4. **Events.** Each verb returns the `TicketChange[]` it caused, and the caller passes them to
   `afterTicketChange` unchanged.
   - `confirmFault` computes the repeat-fault result itself; `repeatInfo` moves out of the route.
   - `assign` returns the new owner ids.
   - A ticket created with a fault type emits the same events as today: `created`, plus `type`
     for a product request, and no `fault` event.
5. **Product, model and SN changes** move into the workflow as `setProduct`. As today, they write
   no timeline entry.
6. **Behaviour kept as today.**
   - An invalid optional type or fault type given while confirming a Feishu request is skipped,
     and the ticket is still created. It is validated before the batch.
   - File uploads write to R2 first, then to D1. These cannot share one batch.
7. **Naming.** `ticketService.ts` is renamed to `ticketWorkflow.ts` with `git mv`. `TicketError`
   and `FAULT_TYPE_OPTION_KEY` stay in it. CONTEXT.md gains a **Ticket workflow** section, and its
   stale `piReviewEvents.action` note is fixed (it should also list REVISION_STARTED and
   REVISION_ABANDONED).

## Tests

- **Existing tests pass unmodified.** A test that needs changing means behaviour changed: stop
  and decide first.
- **New `functions/test/ticketWorkflow.int.test.ts`** asserts only at the workflow interface,
  on a real local D1/R2 from `test/harness.ts`. It covers:
  - Atomic create: everything is written, or nothing.
  - The status guard, for status changes, `take` and `updateProgress`.
  - The event lists, which must match today's.
  - Invalid optional type or fault type is skipped.
  - `setProduct` writes no timeline entry.
  - The Feishu bookkeeping function writes only its columns.

## Rollout

Four steps on this branch. `npm test` and `npm run typecheck` must pass after each step.

1. Rename the module, update imports, and add the CONTEXT.md section.
2. Make each verb one batch that returns `changes`. Move the `PATCH /product` write into
   `setProduct`. Routes forward the returned events.
3. Fold the Feishu confirm chain into `createTicket`. Add `updateProgress`. Make `take` a single
   batch. Add the status guard.
4. Gather the Feishu bookkeeping writes into the one `sync.ts` function, and add the new tests.

Commit locally only. No push and no PR until reviewed.

## Separate decisions (not in this change)

- **A.** Creating a ticket with a fault type does not send the `fault` event, so it raises no
  repeat-fault alert. Web confirmation of a fault does.
  **Resolved 2026-10-29** (`e662da4`). The gap was wider than creation: a repeat needs both a
  product and a fault type, and Feishu tickets usually get their product later. A new `repeat`
  change is now reported whenever product and fault type come together in some way other than
  confirming the fault:
  - a ticket created with both;
  - a product set, or changed, on a ticket whose fault was already confirmed.

  The `repeat` change refreshes the card's banner and alerts the after-sales group. Unlike a
  confirmation, it sends no DM to sales.
- **B.** `setProduct` writes no timeline entry, unlike every other ticket change.
  **Resolved 2026-10-29** (`a1b27e1`): each changed field writes a system note, such as
  "Product: (none) → X", "Model: …" or "SN: A → B".
- **C.** Found while doing this: `POST /tickets` passes the whole request body into `createTicket`.
  A staff user can therefore send an `initialNote` whose `actorId` is someone else, giving a first
  note in another person's name. The Feishu-only inputs added here (stored files, picked type,
  card, device alert) are deliberately kept in `createTicket`'s options, so the body cannot reach
  them. Closing this would mean picking the allowed fields out of the body.
  **Resolved 2026-10-29:** `POST /tickets` now takes only the fields the New ticket form sends,
  plus `summary`. A body `initialNote` is ignored, and `aftersales.int.test.ts` covers this.
  Still open as its own small decision: the owners named at create are not checked to exist, as
  they are when reassigning.
