-- One Feishu identity for both bots (docs/plans/2026-10-21-feishu-identity-and-permissions.md).

-- The Feishu mobile number an admin enters; the portal looks it up in the
-- Feishu directory and links the account (users.feishuUnionId).
ALTER TABLE users ADD COLUMN mobile TEXT;

-- Drafts record who asked by union id now (open id for old links).
ALTER TABLE feishuDrafts RENAME COLUMN requestedByOpenId TO requestedBy;

-- Linking goes through "Sign in with Feishu"; the one-time bind links are gone.
DROP TABLE IF EXISTS feishuBindTokens;
