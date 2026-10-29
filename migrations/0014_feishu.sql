-- Feishu as the after-sales work surface (docs/adr/0002-feishu-as-after-sales-work-surface.md).

-- A system user's Feishu identity, set by the self-service binding flow.
ALTER TABLE users ADD COLUMN feishuOpenId TEXT;
CREATE UNIQUE INDEX users_feishuOpenId_idx ON users(feishuOpenId) WHERE feishuOpenId IS NOT NULL;

-- One-time binding links sent to a Feishu user by the bot.
CREATE TABLE feishuBindTokens (
  token TEXT PRIMARY KEY,
  openId TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  usedAt TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A ticket's internal interactive card, and the customer chat it came from.
ALTER TABLE tickets ADD COLUMN feishuCardMessageId TEXT;
ALTER TABLE tickets ADD COLUMN feishuSourceChatId TEXT;
ALTER TABLE tickets ADD COLUMN feishuSourceMessageId TEXT;

-- A "turn into ticket" request waiting for a staff member to confirm it.
CREATE TABLE feishuDrafts (
  id TEXT PRIMARY KEY,
  requestedByOpenId TEXT NOT NULL,
  sourceChatId TEXT NOT NULL,
  sourceMessageId TEXT NOT NULL,
  text TEXT NOT NULL,
  aiSummary TEXT,
  aiFaultType TEXT,
  ticketId TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Feishu may deliver the same event or callback more than once.
CREATE TABLE feishuSeenEvents (
  eventKey TEXT PRIMARY KEY,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
