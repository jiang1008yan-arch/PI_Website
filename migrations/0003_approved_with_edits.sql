-- SQLite cannot ALTER a CHECK constraint, so we rebuild piReviewEvents
-- to allow the new APPROVED_WITH_EDITS action.

CREATE TABLE piReviewEvents_new (
  id TEXT PRIMARY KEY,
  piId TEXT NOT NULL REFERENCES pi(id) ON DELETE CASCADE,
  actorId TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN ('SUBMITTED', 'APPROVED', 'APPROVED_WITH_EDITS', 'REJECTED')),
  note TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO piReviewEvents_new (id, piId, actorId, action, note, createdAt)
  SELECT id, piId, actorId, action, note, createdAt FROM piReviewEvents;

DROP TABLE piReviewEvents;
ALTER TABLE piReviewEvents_new RENAME TO piReviewEvents;
