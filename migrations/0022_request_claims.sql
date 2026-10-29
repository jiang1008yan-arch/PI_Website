-- When a Feishu ticket request (or Add to ticket) was claimed for creating its
-- ticket (ticketId = 'CREATING'). A claim older than a couple of minutes was
-- left by a Worker that stopped half-way, and may be taken again
-- (docs/plans/2026-10-28-ticket-request.md, decision D). Existing claims have
-- none, so they count as left behind.
ALTER TABLE feishuDrafts ADD COLUMN claimedAt TEXT;
