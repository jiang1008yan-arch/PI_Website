# Effective version: one reader for ADR-0001's rule

Candidate 2 of [the architecture review of 2026-10-28](../architecture-review-2026-10-28.html).
Constraint: **existing behaviour stays the same**, except the one visible change listed under
Decision 2.

## Problem

[ADR-0001](../adr/0001-revision-via-effective-snapshot.md) has a consequence: every query that
serves approved PIs must check `revisionInProgress` and read `effectiveSnapshot` when it is set.
Each reader wrote that rule out by hand, and the copies had drifted apart.

| Where | How it was written |
|---|---|
| `routes/pi.ts` `/pi/approved` | `COALESCE(json_extract(…), pi.col)`, no TRIM |
| `routes/tickets.ts` `approvedPisForOrder` | no TRIM on output, but TRIM when matching |
| `lib/lookup.ts` | `TRIM(COALESCE(…, pi.col, ''))` |
| `lib/deviceMonitor.ts` (×2) | the same as lookup, copied |
| `routes/lookup.ts`, `routes/pi.ts` SN check, `PiDetailPage.tsx` | the approval predicate written by hand |
| `routes/pi.ts` `effectiveContentFor` (export) and `/view` | each parsed the snapshot and built ZH/EN itself |

PI header values are not trimmed when saved. So a customer name with surrounding spaces showed
up trimmed in the type-ahead but untrimmed in the approved list.

## Decisions

1. **One module.** `functions/lib/effectivePi.ts` holds:
   - `EFFECTIVE_ZH(alias = "pi")`: the SQL predicate for ZH PIs that have an effective version
     (approved, or approved and now being revised).
   - `effectiveHeader(column, alias = "pi")`: the SQL for a header value of the effective
     version. It is typed to `productionOrderNo` and `customerCompany`.
   - `readEffective(db, row, zh?)`: returns the frozen content (header over the row, plus items
     with product names) while a revision is in progress, and otherwise `null`, meaning the live
     rows are the effective version. For an EN PI, the caller may pass the ZH row it already
     has. `/view` does this, so it keeps using the ZH row it loaded, exactly as before.

   Single-row checks use the existing `hasEffectiveVersion` in `shared/piCapabilities`, on both
   the server (`POST /pi/:id/devices`) and the web (`PiDetailPage`). `piWorkflow` still writes
   the snapshot and owns its type and parser. The retention rule in `scheduled.ts` is a deletion
   rule rather than a reader, so it is unchanged.
2. **TRIM everywhere: the one visible change.** `effectiveHeader` always trims and falls back to
   `''`. Header values with surrounding spaces now appear trimmed in two places: the approved PI
   list (`/pi/approved`) and a ticket's matched PIs (`approvedPisForOrder`). The `''` fallback
   never shows in practice, because both columns are `NOT NULL`. Matching was already done on
   trimmed values, for example the duplicate production-order check.
3. **Not moved this time.** `PiPage` still parses the snapshot on the client to highlight
   changes. Moving the snapshot type and parser into `shared/` belongs with candidate 6 (line
   item kernel).

## Tests

- Existing tests pass unmodified. The revision tests in `approval.int.test.ts` cover `/view`
  and the effective export end to end.
- The new `functions/test/effectivePi.int.test.ts` runs against a real local D1. It covers:
  - Which PIs have an effective version: approved and being-revised ZH PIs do; drafts,
    PIs in review, and EN PIs do not.
  - A revised PI reads the snapshot's values.
  - Values are trimmed, and a blank value becomes `''`.
  - The approved list shows trimmed values. This is the visible change.
  - The SQL helpers work under a different table alias.
  - `readEffective` returns `null` with no revision in progress, and returns the frozen ZH
    and EN content, with product names, during one.

## Rollout

Three steps on this branch. `npm test` and the typecheck must pass after each step.

1. Add `effectivePi.ts` and its tests.
2. Point the SQL readers at it: `/pi/approved`, `approvedPisForOrder`, `lib/lookup`,
   `routes/lookup`, and both queries in `deviceMonitor`.
3. Switch the export and `/view` to `readEffective`, and the row checks to
   `hasEffectiveVersion`. Write this plan and the CONTEXT.md line.

Commit locally only. This branch is the head of PR #16, so pushing it would add this work
to that PR.
