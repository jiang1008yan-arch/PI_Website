-- Reservation only (需求4, 方案A): the table and helper exist but nothing
-- writes to it yet. Hook points carry a TODO until the company backend's
-- payload contract is finalized, so the table stays empty (zero debt).

CREATE TABLE integrationOutbox (
  id TEXT PRIMARY KEY,
  eventType TEXT NOT NULL CHECK (eventType IN ('TICKET', 'PI_ZH')),
  refId TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sentAt TEXT,
  lastError TEXT
);

CREATE INDEX integrationOutbox_status_idx ON integrationOutbox(status);
