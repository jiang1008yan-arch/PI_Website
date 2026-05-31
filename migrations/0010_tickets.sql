-- 需求2: after-sales ticket system.
-- Fixed skeleton columns (contact, status, token-prebound customer/order, product
-- selection) live on `tickets`; the configurable questionnaire answers live in
-- `tickets.answers` (JSON) and are shaped by `ticketFields`. Public submission is
-- gated by a stateful `ticketLinks` token + Turnstile.

CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  ticketNo TEXT NOT NULL UNIQUE,
  seq INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
  customerCompany TEXT NOT NULL DEFAULT '',
  orderNo TEXT NOT NULL DEFAULT '',
  contactName TEXT NOT NULL,
  contactInfo TEXT NOT NULL,
  productId TEXT,
  answers TEXT NOT NULL DEFAULT '{}',
  assignedSalesId TEXT,
  assignedServiceId TEXT,
  linkId TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX tickets_status_idx ON tickets(status);
CREATE INDEX tickets_product_idx ON tickets(productId);

-- Timeline: every status change and every free-text note is one row.
CREATE TABLE ticketUpdates (
  id TEXT PRIMARY KEY,
  ticketId TEXT NOT NULL,
  actorId TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('STATUS', 'NOTE')),
  statusFrom TEXT,
  statusTo TEXT,
  note TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ticketUpdates_ticket_idx ON ticketUpdates(ticketId);

-- Stateful tokens: sales/service generate a link, can list and revoke it.
CREATE TABLE ticketLinks (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  customerCompany TEXT NOT NULL DEFAULT '',
  orderNo TEXT NOT NULL DEFAULT '',
  createdById TEXT NOT NULL,
  createdByRole TEXT NOT NULL,
  assignedSalesId TEXT,
  assignedServiceId TEXT,
  expiresAt TEXT NOT NULL,
  revokedAt TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ticketLinks_token_idx ON ticketLinks(token);
CREATE INDEX ticketLinks_creator_idx ON ticketLinks(createdById);

-- Admin-configurable questionnaire (clone of productFields, plus `required`).
CREATE TABLE ticketFields (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  fieldType TEXT NOT NULL CHECK (fieldType IN ('TEXT', 'DROPDOWN')),
  options TEXT,
  required INTEGER NOT NULL DEFAULT 0,
  sortOrder INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE ticketNumberSequences (
  date TEXT PRIMARY KEY,
  lastSeq INTEGER NOT NULL
);
