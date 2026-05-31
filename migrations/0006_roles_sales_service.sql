-- Rename the sales role USER -> SALES and add the new after-sales role SERVICE.
-- SQLite cannot ALTER a CHECK constraint, so the users table is rebuilt.
-- Child tables reference users by name, so drop+rename keeps their FKs valid.

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  displayName TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'SALES', 'SERVICE')),
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users_new (id, username, passwordHash, displayName, role, createdAt)
  SELECT id, username, passwordHash, displayName,
         CASE role WHEN 'USER' THEN 'SALES' ELSE role END,
         createdAt
  FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
