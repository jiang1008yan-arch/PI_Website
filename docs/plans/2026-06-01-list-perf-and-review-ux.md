# PI list performance, review editing & home notifications

Date: 2026-06-01

Addresses the five requests about list smoothness, PI UI, review notifications,
confirmed-received notifications, and removing decorative subtitle text.

## 1. PI List loading smoothness

**Diagnosis.** The list (`GET /pi`) never eagerly loaded line items — those are
already click-to-load via `GET /pi/:id`. The sluggishness came from two places:

- The endpoint returned **every column** (including the heavy `submittedSnapshot`
  JSON) for **every PI of both languages**, then the client discarded the other
  language.
- The per-language stale-while-revalidate cache in `usePiEditor` already paints
  instantly, so the cost was purely payload size.

**Change.** `GET /pi`:
- Projects only the columns a PI card / filter needs (`PI_LIST_COLUMNS`) — drops
  `submittedSnapshot` and the full sender/customer detail set.
- Accepts an optional `?language=EN|ZH` filter so each workspace fetches only its
  own half of the list. `usePiEditor` and `ConfirmedReceivedPis` pass it.

Line items remain click-to-load (unchanged). The inline 3-day draft purge was left
in place because there is no cron trigger configured in `wrangler.toml`, so it is
currently the only purge path; it only runs a single `SELECT` when nothing is stale.

## 2. EN/ZH PI editor visual polish

Deferred at the user's request ("本次先不动 UI"). No changes.

## 3. Pending review notifications + name + editing

- **Home badge.** The "Pending Reviews" card now shows a count badge (admins),
  fed by `GET /pi/review-queue`.
- **Name by production order number.** The review queue card shows
  `productionOrderNo` (falling back to `piNo`).
- **Editing in the pending view.** `ReviewPage` queue cards now link to the
  existing editable review flow at `/pi/zh?piId=<id>`, where an admin already gets
  full header/line-item editing plus Confirm / Reject (buffered review-mode edits
  committed on approve). The old read-only detail panel + approve/reject/export was
  removed — its pre-approval "Download Excel" was effectively dead (server
  `canExportPi` requires APPROVED for ZH), so nothing of value was lost.

## 4. Confirmed-received notifications + snapshot toggle

- **Home badge.** The "Confirmed Received PIs" card shows a count badge of approved
  ZH PIs the user is involved in (`isUserApprovedChinesePi`).
- **Approved version / What I submitted.** Verified the toggle is sound:
  `submittedSnapshot` is frozen at submit-for-review and never cleared on approve,
  so the APPROVED ZH editor can toggle between the live row and the original
  submission. No code change needed.

## 5. Remove decorative subtitle text

- `PageHero.description` is now optional and was removed from the PI, Product,
  Confirmed-Received and Review pages.
- Home: section subtitles and per-card descriptions removed.
- Review page: the "Only PIs sent to you are shown here." helper line removed.

Functional inline guidance (empty-state help, the ZH→EN field-mapping instruction
on the Products page) was intentionally kept.
