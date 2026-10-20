-- Latest status with attachments on tickets.

-- Lines the system writes itself (type, owner, fault, customer changes) are
-- kept apart from people's progress updates, which make up the latest status.
ALTER TABLE ticketUpdates ADD COLUMN isSystem INTEGER NOT NULL DEFAULT 0;
-- A follow-up note added to an earlier update.
ALTER TABLE ticketUpdates ADD COLUMN parentId TEXT;

UPDATE ticketUpdates SET isSystem = 1
WHERE kind = 'NOTE' AND (
  note LIKE 'Fault type confirmed:%' OR note LIKE 'Ticket type:%' OR note LIKE 'After-sales owner:%'
  OR note LIKE 'Sales owner:%' OR note LIKE 'Customer:%' OR note LIKE 'Production order no.:%'
);

-- Pictures and files attached to a ticket update, stored in R2 (FILES) and
-- served only to signed-in ticket users.
CREATE TABLE ticketAttachments (
  id TEXT PRIMARY KEY,
  ticketId TEXT NOT NULL,
  updateId TEXT NOT NULL,
  fileName TEXT NOT NULL,
  contentType TEXT NOT NULL,
  size INTEGER NOT NULL,
  r2Key TEXT NOT NULL,
  uploadedById TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ticketAttachments_ticket_idx ON ticketAttachments(ticketId);
