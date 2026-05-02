ALTER TABLE pi ADD COLUMN assignedToId TEXT;

CREATE TABLE appOptions (
  id TEXT PRIMARY KEY,
  optionKey TEXT NOT NULL,
  value TEXT NOT NULL,
  sortOrder INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX appOptions_key_idx ON appOptions(optionKey, sortOrder);
