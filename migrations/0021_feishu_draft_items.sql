-- Collecting a ticket's material in the bot's private chat
-- (docs/plans/2026-10-27-feishu-collect-and-similar-tickets.md).

-- One piece of material on a request: a text, or a picture / voice message /
-- video / file stored in R2 (FILES). `position` orders them: the time the
-- message reached the bot, then the place inside a merged forward.
CREATE TABLE feishuDraftItems (
  id TEXT PRIMARY KEY,
  draftId TEXT NOT NULL,
  sourceMessageId TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'FILE')),
  -- The text itself, or a voice message's transcript once the AI has run.
  text TEXT,
  fileName TEXT,
  contentType TEXT,
  size INTEGER,
  durationMs INTEGER,
  r2Key TEXT,
  -- Why a file was not saved (inside a merged forward, too large, download failed).
  problem TEXT,
  position TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX feishuDraftItems_draft_idx ON feishuDraftItems(draftId, position);

-- Last time material was added (the 6-hour limit counts from here), Discard,
-- when the form was prepared, which items the last AI run saw, the AI's
-- roll-up of all the material, and the customer group the forwarded messages
-- came from.
ALTER TABLE feishuDrafts ADD COLUMN updatedAt TEXT;
ALTER TABLE feishuDrafts ADD COLUMN dismissedAt TEXT;
ALTER TABLE feishuDrafts ADD COLUMN formOpenedAt TEXT;
ALTER TABLE feishuDrafts ADD COLUMN aiItemIds TEXT;
ALTER TABLE feishuDrafts ADD COLUMN aiDigest TEXT;
ALTER TABLE feishuDrafts ADD COLUMN suggestedChatId TEXT;

-- Requests from before this change are closed: each person now has one open
-- request at a time, kept unique below.
UPDATE feishuDrafts SET expiredAt = CURRENT_TIMESTAMP
WHERE ticketId IS NULL AND expiredAt IS NULL AND requestedBy <> '';

CREATE UNIQUE INDEX feishuDrafts_one_open_idx ON feishuDrafts(requestedBy)
WHERE requestedBy <> '' AND ticketId IS NULL AND expiredAt IS NULL AND dismissedAt IS NULL;
