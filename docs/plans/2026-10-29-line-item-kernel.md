# Line item kernel: codec, field semantics, model rule and amounts in shared/

Candidate 6 of [the architecture review of 2026-10-28](../architecture-review-2026-10-28.html).
Constraint: **existing behaviour stays the same**, except the one change listed under Decision 3.

## Problem

CONTEXT.md says `fieldValues` goes only through `piItemCodec` and `lineItemFields`. That seam
existed only in the web bundle:

- **The line amount `q·p·(1−d/100)` was written six times:**
  - the PI Assistant card (`piCard.ts`);
  - Excel (`tokens.ts`, twice);
  - `PiDetailPage`;
  - `LineItem`;
  - `usePiEditor`.
- **The server had three `fieldValues` parsers of its own**: in `routes/pi.ts`, in
  `piWorkflow.toItemInput`, and in `notifyPi`. The web codec threw on malformed JSON, while the
  server's parsers returned `[]`.
- **`functions/lib/piLink.ts` had its own copy of the model rule**: a normalizer, the prefix, the
  segment key, and the seeded fields.
- **The two snapshots store `fieldValues` differently.** `submittedSnapshot` keeps a JSON
  string; `effectiveSnapshot` keeps an array. `PiPage` handled the array case by hand.

## Decisions

1. **Move into `shared/` with `git mv`.** `piItemCodec.ts`, `lineItemFields.ts` and `modelRule.ts`
   move from `web/src/pi/`, together with their tests; the tests change only their import paths.
   The new `shared/lineItem.ts` holds the shared `FieldValue`, `PiItem` and `Language` types
   (structural, so `web/src/types.ts` now re-exports them) and the new `lineAmount(item)` and
   `itemsTotal(items)`.
2. **Every caller reads the kernel.**
   - **Web:** `LineItem`, `usePiEditor`, `PiDetailPage` and Excel `tokens.ts` use the amount
     functions. `PiPage` reads the frozen effective snapshot with `parsePiItems`.
   - **Server:** `routes/pi.ts`, `piWorkflow` and `notifyPi` read `fieldValues` with
     `parseFieldValues`. `piCard` uses `lineAmount` and `itemsTotal`; it still exports
     `lineAmount`, which its test uses.
   - **`piLink`** seeds ZH model fields with `modelRuleSeedFields` + `applyModelRule`, and finds
     the rule with `modelRuleKey`. It keeps its own "enabled rules only" check. Running the
     generator with no segment picked gives the prefix, which is what `piLink` used to write
     directly.
3. **The codec reads both encodings and never throws.** `parseFieldValues` accepts a JSON string
   or an array, and returns `[]` for anything unreadable. Writers and stored data are unchanged,
   so no migration is needed. **The one changed behaviour:** malformed JSON used to throw in the
   web codec. It now gives no fields, as on the server, so a corrupt row shows empty fields
   instead of breaking the page. The test that asserted the throw now asserts this.
4. **Every sortOrder is kept:**
   - `__modelRule` and `__modelPrefix`: −10
   - segments: −9+i
   - Model, Model Lines and Order Code Meaning: −5, −4 and −3
   - fields synthesized by `lineItemFields`: −1

## Tests

- The moved tests (`piItemCodec`, `lineItemFields`, and `modelRule` at 443 lines) pass with
  import-path changes only, apart from the one malformed-JSON case in Decision 3.
- The new tests cover:
  - the codec: arrays and strings read the same, and a non-string gives `[]`;
  - `shared/lineItem.test.ts`: `lineAmount` and `itemsTotal` are bit-identical to the old
    expression, including string inputs and order;
  - `piLink.test.ts`: a pin of the exact seeded fields (labels, values, sortOrder). It was
    written before the refactor, passed against the old code, and passes after it.
- 385 tests pass in 36 files. Server tsc and web tsc are both clean.
- Browser and live-server check:
  - **EN→ZH seeding.** An admin set a ZH model rule (prefix `CHG`, one segment), and a
    salesperson created an EN PI and synced it to ZH. The ZH item carries `__modelPrefix=CHG`,
    `型号=CHG` and `Model Lines=CHG` with sortOrders −10, −10, −9, −5, −4 and −3.
  - **Amounts.** In the editor, the lines 3 × 19.99 at 7.5% and 7 × 1234.56 at 12% show 55.47 and
    7,604.89, with a total of 7,660.36. These equal the formula.

## Rollout

Three steps on this branch. `npm test` and both typechecks must pass after each step.

1. Move the three modules and their tests into `shared/`, and add the types and amounts.
2. Switch the web callers.
3. Switch the server callers, update CONTEXT.md, run the browser check and write this plan.

Commit locally only. No push.
