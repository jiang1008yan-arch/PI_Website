-- Two-step ZH approval (presales confirmation by ADMIN, then commerce approval
-- by the new COMMERCE role) and revisions of approved PIs.
--
-- 1. users.role gains COMMERCE. SQLite cannot ALTER a CHECK constraint, so the
--    users table is rebuilt. As in 0006, D1 enforces foreign keys during
--    migrations, so every table that references users (directly, or through pi)
--    is copied aside, emptied, and restored after the rebuild.
-- 2. piReviewEvents is recreated (not restored as-is) with a `step` column
--    (PRESALES | COMMERCE), a `revisionNo`, and two new actions for revisions.
-- 3. pi gains the revision bookkeeping columns and `approvedAt`.

CREATE TABLE migration_0012_productTemplates AS SELECT * FROM productTemplates;
CREATE TABLE migration_0012_contractTemplates AS SELECT * FROM contractTemplates;
CREATE TABLE migration_0012_excelTemplates AS SELECT * FROM excelTemplates;
CREATE TABLE migration_0012_pi AS SELECT * FROM pi;
CREATE TABLE migration_0012_piItems AS SELECT * FROM piItems;
CREATE TABLE migration_0012_piReviewEvents AS SELECT * FROM piReviewEvents;

DELETE FROM productTemplates;
DELETE FROM contractTemplates;
DELETE FROM excelTemplates;
DELETE FROM piReviewEvents;
DELETE FROM piItems;
DELETE FROM pi;

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  displayName TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'SALES', 'SERVICE', 'COMMERCE')),
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users_new (id, username, passwordHash, displayName, role, createdAt)
  SELECT id, username, passwordHash, displayName, role, createdAt FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

INSERT INTO productTemplates SELECT * FROM migration_0012_productTemplates;
INSERT INTO contractTemplates SELECT * FROM migration_0012_contractTemplates;
INSERT INTO excelTemplates SELECT * FROM migration_0012_excelTemplates;
INSERT INTO pi SELECT * FROM migration_0012_pi;
INSERT INTO piItems SELECT * FROM migration_0012_piItems;

DROP TABLE piReviewEvents;
CREATE TABLE piReviewEvents (
  id TEXT PRIMARY KEY,
  piId TEXT NOT NULL REFERENCES pi(id) ON DELETE CASCADE,
  actorId TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'REVISION_STARTED', 'REVISION_ABANDONED')),
  step TEXT CHECK (step IS NULL OR step IN ('PRESALES', 'COMMERCE')),
  revisionNo INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Every approval before this migration was the single presales step.
INSERT INTO piReviewEvents (id, piId, actorId, action, step, revisionNo, note, createdAt)
  SELECT id, piId, actorId, action,
         CASE WHEN action IN ('APPROVED', 'REJECTED') THEN 'PRESALES' ELSE NULL END,
         1, note, createdAt
  FROM migration_0012_piReviewEvents;
CREATE INDEX piReviewEvents_pi_idx ON piReviewEvents(piId);

DROP TABLE migration_0012_productTemplates;
DROP TABLE migration_0012_contractTemplates;
DROP TABLE migration_0012_excelTemplates;
DROP TABLE migration_0012_pi;
DROP TABLE migration_0012_piItems;
DROP TABLE migration_0012_piReviewEvents;

-- Revision bookkeeping. effectiveSnapshot holds the approved ZH + linked EN
-- content (JSON) while a revision is in progress; NULL otherwise.
ALTER TABLE pi ADD COLUMN revisionNo INTEGER NOT NULL DEFAULT 1;
ALTER TABLE pi ADD COLUMN revisionInProgress INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pi ADD COLUMN revisionReason TEXT;
ALTER TABLE pi ADD COLUMN effectiveSnapshot TEXT;
ALTER TABLE pi ADD COLUMN approvedAt TEXT;

-- PIs already APPROVED stay APPROVED; their approval time is the last APPROVED event.
UPDATE pi SET approvedAt = (
  SELECT MAX(createdAt) FROM piReviewEvents WHERE piReviewEvents.piId = pi.id AND action = 'APPROVED'
) WHERE status = 'APPROVED';

CREATE INDEX pi_status_idx ON pi(language, status);
CREATE INDEX pi_approvedAt_idx ON pi(approvedAt);
CREATE INDEX pi_productionOrderNo_idx ON pi(productionOrderNo);
