-- After-sales lookup: device serial numbers registered against approved PIs,
-- and the after-sales-confirmed product line and fault type on tickets.
--
-- devices.piId deliberately has no foreign key: tables referencing pi must be
-- moved aside whenever users/pi are rebuilt (see 0006, 0012). The purge job
-- deletes a PI's devices together with the PI.

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  serialNumber TEXT NOT NULL UNIQUE,
  piId TEXT NOT NULL,
  createdById TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX devices_pi_idx ON devices(piId);

-- tickets.orderNo already holds the production order number (the UI now says so).
-- productId (existing) + productModel record which PI line the issue is about.
ALTER TABLE tickets ADD COLUMN productModel TEXT;
ALTER TABLE tickets ADD COLUMN serialNumber TEXT;
ALTER TABLE tickets ADD COLUMN faultType TEXT;
ALTER TABLE tickets ADD COLUMN faultConfirmedById TEXT;
ALTER TABLE tickets ADD COLUMN faultConfirmedAt TEXT;

CREATE INDEX tickets_fault_idx ON tickets(productId, faultType);
CREATE INDEX tickets_orderNo_idx ON tickets(orderNo);
