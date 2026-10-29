# Ticket capabilities kernel: the ticket rules once, for server, web and cards

Candidate 5 of [the architecture review of 2026-10-28](../architecture-review-2026-10-28.html).
Constraint: **existing behaviour stays the same.** No user-visible change.

## Problem

The ticket rules were copied in three places:

- **Status transitions, three copies:**
  - the server, `functions/lib/ticketAccess.ts`;
  - the web, `web/src/tickets/ticketShared.ts`, commented "Mirrors …";
  - the Feishu ticket card's `NEXT` in `functions/lib/feishu/cards.ts`.
- **"Classify, and confirm the fault, before resolving", two copies:**
  - the server, `ticketWorkflow.ts`, whose messages end "…before resolving it.";
  - the web, `TicketDetail.tsx`, whose messages end "…before resolving.".
- **`ticketAccess` was shallow.** It had nine predicates, eight of them with the same body,
  `role === "ADMIN" || role === "SERVICE"`. They returned only a boolean and had no table test.
- **The web checked roles itself, about eight times:**
  - `TicketDetail`: `canManage` and `isAdmin`;
  - `DeviceSerials`: `canEdit`;
  - `FaultAnalytics`: `canConfigure`;
  - `TicketListPanel`: `canCreate`;
  - `Home`: two checks.

## Decisions

1. **`shared/ticketCapabilities.ts`.** This is a pure, bundle-neutral module, like
   `shared/piCapabilities`. It holds:
   - `ticketCapabilities(role)`: one table of named capabilities per role: `use`,
     `ownTicketsOnly`, `create`, `changeStatus`, `writeNote`, `assignService`, `assignSales`,
     `confirmFault`, `registerSn` and `manageFaultTypes`. ADMIN and SERVICE have all of them except
     `ownTicketsOnly`. SALES have `use` and `ownTicketsOnly`. COMMERCE and PRESALES have none.
   - `nextStatuses(status)` and `isValidTransition(from, to)`: the only transition table.
   - `resolveBlocker(ticket)`: returns `"type"`, `"fault"` or `null`. Each caller keeps its own
     message text, so the server's and the web's wording stay as they were.
2. **Named capabilities, not one manage flag.** The eight identical predicates keep their
   intent: if a role ever gets only one of them, that is a single cell in the table.
3. **Server.** `ticketAccess` keeps every predicate name (`canChangeStatus`, …), which now read the
   table, so `ticketWorkflow` and the routes are unchanged. Ownership ("sales read only the
   tickets in their name", `canReadTicket`) stays on the server. `ticketWorkflow` uses
   `resolveBlocker`, and the Feishu card offers `nextStatuses`.
4. **Web, section by section.** The ticket page gates each section by the capability the server
   checks for it:
   - customer fields, equipment, and type/fault: `confirmFault`;
   - activity: `writeNote`;
   - status buttons: `changeStatus`;
   - each assignee: `assignSales` / `assignService`.

   The other pages:
   - SN registration: `registerSn`;
   - Fault Analytics: the Device monitoring tab uses `confirmFault`, the same check as
     `GET /devices/monitor`; the Fault types & alerts tab uses `manageFaultTypes`;
   - the "New ticket" link: `create`;
   - the home page's After-Sales section and its new-ticket badge: `use`.

   Today every one of these has the same value for every role, so nothing a user sees changes.
5. **Out of scope.** These stay as they are:
   - the PI-side client checks that bypass `piCapabilities` (for example `PiDetailPage`'s
     `canDownload`);
   - the assignee candidate lists (which roles can own a side);
   - the "Approved PI Lookup" tile on the home page.

## Tests

- New `shared/ticketCapabilities.test.ts` covers:
  - the full role matrix, written out cell by cell;
  - that no user gets no capability;
  - the transitions;
  - `resolveBlocker`.
- Existing tests pass unmodified (380 in 35 files). Server tsc and web tsc are both clean.
- Browser check on the local dev server, using the same ticket as each role:

  | Role | Ticket page | "New ticket" | Fault Analytics tabs | Home After-Sales |
  |---|---|---|---|---|
  | ADMIN | hint, update form, type and fault controls, move buttons, resolve hint, 4 selects | yes | all 3 | yes |
  | SERVICE | the same as ADMIN | yes | all 3 | yes |
  | SALES | read-only: no buttons, selects or textarea | no | Statistics only | yes |
  | COMMERCE | — | — | — | no |

  There were no console errors.

## Rollout

Three steps on this branch. `npm test` and both typechecks must pass after each step.

1. Add the kernel and its tests.
2. Point the server's `ticketAccess`, the resolve check, the Feishu card and the web transition
   copy at the kernel.
3. Switch the web role checks to the kernel, run the browser check, and write this plan.

Commit locally only. No push.
