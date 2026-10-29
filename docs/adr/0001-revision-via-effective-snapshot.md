# Revisions freeze the effective version instead of copying PI rows

An approved PI can be revised, and until the revision gets commerce approval the previously approved content must stay the effective version for commerce, after-sales and downloads. We freeze that effective version (ZH + linked EN header and items) as JSON on the PI row when a revision starts, and let the live row go back to DRAFT so the existing editor and workflow handle the revision unchanged; readers of the effective version read the snapshot while a revision is in progress, and abandoning the revision restores the live row from it.

## Considered Options

- **Copy the PI rows for each revision** — rejected: `pi.piNo` is unique, every list, link (`linkedPiId`) and lookup would have to learn which copy is current, and the editor would need a second mode.
- **Keep revision edits only in a JSON draft table** — rejected: the editor works on PI rows, so it would need a parallel JSON-backed editing path.

## Consequences

Every query that serves "approved PIs" must check `revisionInProgress` and read `effectiveSnapshot` when it is set. Retention never deletes a PI with a revision in progress.
