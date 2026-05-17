-- Adds the submitted-snapshot column captured at submit-for-review time, and
-- tightens piReviewEvents.action by dropping APPROVED_WITH_EDITS (existing rows
-- of that action are converted to APPROVED — the "with edits" distinction is
-- now derivable from pi.submittedSnapshot vs the live pi row).

ALTER TABLE pi ADD COLUMN submittedSnapshot TEXT;

UPDATE piReviewEvents SET action = 'APPROVED' WHERE action = 'APPROVED_WITH_EDITS';

CREATE TABLE piReviewEvents_new (
  id TEXT PRIMARY KEY,
  piId TEXT NOT NULL REFERENCES pi(id) ON DELETE CASCADE,
  actorId TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN ('SUBMITTED', 'APPROVED', 'REJECTED')),
  note TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO piReviewEvents_new (id, piId, actorId, action, note, createdAt)
  SELECT id, piId, actorId, action, note, createdAt FROM piReviewEvents;

DROP TABLE piReviewEvents;
ALTER TABLE piReviewEvents_new RENAME TO piReviewEvents;
