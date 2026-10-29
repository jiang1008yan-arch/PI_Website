# Quick deletions

These are the "quick deletions" from [the architecture review of 2026-10-28](../architecture-review-2026-10-28.html):
small items that pass the deletion test directly. **No user-visible change.** Each item is its own
local commit, and `npm test` plus both typechecks passed after every one.

| # | Item | Done |
|---|---|---|
| 1 | Stale drizzle schema | Deleted `functions/lib/schema.ts`, `getDb` and `drizzle.config.ts`, removed the `db:generate` script, and uninstalled `drizzle-orm` and `drizzle-kit` (18 packages). `getDb` had no callers. The schema stopped around migration 10, so running `db:generate` would have produced a wrong migration. Migrations are hand-written SQL. |
| 2 | Time and secret helpers | `sqlTime` (six copies, including `piWorkflow`'s `sqlTimestamp`) and `parseSqlTime` (three copies) are now one each in `functions/lib/db.ts`. `sameSecret` (two copies) is now one, in `functions/lib/auth.ts`. |
| 3 | Ticket types | `TICKET_TYPES` moved from `aiTriage.ts`, and the type names (written three times on the server and once on the web) are now one `TICKET_TYPE_LABEL`, both in `shared/ticketCapabilities.ts`. A test pins the names. |
| 4 | `ticketNumber` / `piNumber` | **Skipped.** The PI sequence starts from the highest existing PI number and the ticket sequence does not, so sharing them would mean adding a parameter to save about ten lines. |
| 5 | Personal AI key | `aiKeys.ts` (renamed with `git mv`) and `userAi.ts` merged into `functions/lib/personalAiKey.ts`. It is the only reader and writer of `userAiSettings`, and the AI settings route no longer writes the table itself. |
| 6 | `'From Feishu:'` | Three modules depended on this prefix: the card route wrote it, and the requirement pool and similar tickets matched it. It now has one owner, `functions/lib/feishu/requestNote.ts`, a pure module that writes the note in its two forms and reads the customer's words back. A new test pins both forms. |
| 7 | CONTEXT.md event log | Already fixed with candidate 1. |

## Notes

- Existing tests were unchanged apart from import paths, in `ticketRequest.int`, `feishu.test`
  and `ticketTypes.int`.
- 388 tests pass in 37 files.
- While this work ran, the machine had less than 1 GB of commit memory free, mostly held by
  `vmmem`. `tsc` crashed out of memory twice and then passed with
  `NODE_OPTIONS=--max-semi-space-size=1`; the failure was the machine, not the code.
