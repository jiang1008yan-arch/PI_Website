-- Presales approvers picked by sales, the PI Assistant Feishu bot, and a
-- concurrency guard for approvals.
--
-- 1. users.role gains PRESALES (the first approval step, until now ADMIN only)
--    and users gains feishuUnionId: the same id for one person across all of
--    the company's Feishu apps (open_id is per app), used by the PI Assistant
--    bot and "Sign in with Feishu". SQLite cannot ALTER a CHECK constraint, so
--    users is rebuilt; as in 0006/0012 every table that references users
--    (directly, through pi, or with ON DELETE CASCADE) is copied aside first.
-- 2. pi.commerceId: the commerce approver the submitter picked (NULL = any
--    commerce user, as before).
-- 3. feishuPiCards: PI Assistant approval cards, so later actions can close them.
-- 4. workflowGuard: lets a workflow batch abort when its conditional status
--    UPDATE matched no row (someone else acted first) — see piWorkflow.ts.

CREATE TABLE migration_0019_productTemplates AS SELECT * FROM productTemplates;
CREATE TABLE migration_0019_contractTemplates AS SELECT * FROM contractTemplates;
CREATE TABLE migration_0019_excelTemplates AS SELECT * FROM excelTemplates;
CREATE TABLE migration_0019_pi AS SELECT * FROM pi;
CREATE TABLE migration_0019_piItems AS SELECT * FROM piItems;
CREATE TABLE migration_0019_piReviewEvents AS SELECT * FROM piReviewEvents;
CREATE TABLE migration_0019_userAiSettings AS SELECT * FROM userAiSettings;

DELETE FROM productTemplates;
DELETE FROM contractTemplates;
DELETE FROM excelTemplates;
DELETE FROM piReviewEvents;
DELETE FROM piItems;
DELETE FROM pi;
DELETE FROM userAiSettings;

DROP INDEX IF EXISTS users_feishuOpenId_idx;

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  displayName TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'SALES', 'SERVICE', 'COMMERCE', 'PRESALES')),
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  feishuOpenId TEXT,
  feishuUnionId TEXT
);

INSERT INTO users_new (id, username, passwordHash, displayName, role, createdAt, feishuOpenId)
  SELECT id, username, passwordHash, displayName, role, createdAt, feishuOpenId FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE UNIQUE INDEX users_feishuOpenId_idx ON users(feishuOpenId) WHERE feishuOpenId IS NOT NULL;
CREATE UNIQUE INDEX users_feishuUnionId_idx ON users(feishuUnionId) WHERE feishuUnionId IS NOT NULL;

-- Column lists are unchanged by this migration, so SELECT * restores them in order.
INSERT INTO productTemplates SELECT * FROM migration_0019_productTemplates;
INSERT INTO contractTemplates SELECT * FROM migration_0019_contractTemplates;
INSERT INTO excelTemplates SELECT * FROM migration_0019_excelTemplates;
INSERT INTO pi SELECT * FROM migration_0019_pi;
INSERT INTO piItems SELECT * FROM migration_0019_piItems;
INSERT INTO piReviewEvents SELECT * FROM migration_0019_piReviewEvents;
INSERT INTO userAiSettings SELECT * FROM migration_0019_userAiSettings;

DROP TABLE migration_0019_productTemplates;
DROP TABLE migration_0019_contractTemplates;
DROP TABLE migration_0019_excelTemplates;
DROP TABLE migration_0019_pi;
DROP TABLE migration_0019_piItems;
DROP TABLE migration_0019_piReviewEvents;
DROP TABLE migration_0019_userAiSettings;

ALTER TABLE pi ADD COLUMN commerceId TEXT;

CREATE TABLE feishuPiCards (
  id TEXT PRIMARY KEY,
  piId TEXT NOT NULL,
  unionId TEXT NOT NULL,
  messageId TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX feishuPiCards_pi_idx ON feishuPiCards(piId);

CREATE TABLE workflowGuard (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
