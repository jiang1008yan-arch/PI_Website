-- Personal AI keys, ticket types and the product-request pool
-- (docs/plans/2026-10-20-ai-keys-ticket-types-requirement-pool.md).

-- Each user's own AI provider key, encrypted with AES-GCM under the server's
-- AI_KEY_SECRET and bound to the user id; never returned in plain text.
CREATE TABLE userAiSettings (
  userId TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('QWEN', 'DEEPSEEK')),
  apiKeyCipher TEXT NOT NULL,
  apiKeyIv TEXT NOT NULL,
  apiKeyLast4 TEXT NOT NULL,
  model TEXT,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- What a ticket is about. Only FAULT tickets carry a fault type; a ticket must
-- have a type before it can be resolved.
ALTER TABLE tickets ADD COLUMN ticketType TEXT CHECK (ticketType IN ('FAULT', 'PRODUCT_REQUEST', 'OTHER'));
-- One-line summary (AI-suggested or written by after-sales).
ALTER TABLE tickets ADD COLUMN summary TEXT;
-- The row written to the product managers' Feishu Bitable requirement pool.
ALTER TABLE tickets ADD COLUMN bitableRecordId TEXT;

UPDATE tickets SET ticketType = 'FAULT' WHERE faultType IS NOT NULL AND faultType <> '';

-- AI's suggested ticket type on a Feishu draft.
ALTER TABLE feishuDrafts ADD COLUMN aiTicketType TEXT;
