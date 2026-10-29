-- Owner reminders and Feishu draft expiry
-- (docs/plans/2026-10-20-closing-loops-lookup-device-status.md).

-- The question card sent for a Feishu request, so it can be greyed out when the
-- request expires unanswered (6 hours).
ALTER TABLE feishuDrafts ADD COLUMN cardMessageId TEXT;
ALTER TABLE feishuDrafts ADD COLUMN expiredAt TEXT;

-- When the owner was last reminded that an open ticket has not been updated.
ALTER TABLE tickets ADD COLUMN lastRemindedAt TEXT;

-- Ticket cards now go privately to the after-sales owner instead of the group;
-- this records whose chat the current card is in, so a hand-over sends a new
-- card to the new owner and marks the old one as handed over.
ALTER TABLE tickets ADD COLUMN feishuCardOwnerId TEXT;
