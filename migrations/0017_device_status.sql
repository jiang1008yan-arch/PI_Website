-- Device status from the charger backend, and alerts on it
-- (docs/plans/2026-10-20-closing-loops-lookup-device-status.md).
-- The backend pushes events by SN to POST /api/devices/status. SNs do not have
-- to be registered on a PI (devices table) to be tracked.

-- Latest known state per SN, and the alert currently open for it (if any).
CREATE TABLE deviceStatus (
  serialNumber TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('ONLINE', 'OFFLINE', 'FAULT')),
  faultCode TEXT,
  faultText TEXT,
  lastEventAt TEXT NOT NULL,
  offlineSince TEXT,
  alertKind TEXT CHECK (alertKind IN ('FAULT', 'OFFLINE')),
  alertOpenedAt TEXT,
  alertDraftId TEXT,
  alertTicketId TEXT,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX deviceStatus_alert_idx ON deviceStatus(alertKind);

-- Every event as received (append-only).
CREATE TABLE deviceEvents (
  id TEXT PRIMARY KEY,
  serialNumber TEXT NOT NULL,
  status TEXT NOT NULL,
  faultCode TEXT,
  faultText TEXT,
  occurredAt TEXT NOT NULL,
  receivedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX deviceEvents_sn_idx ON deviceEvents(serialNumber, occurredAt);

-- A Feishu request can come from a chat message or from a device alert; alert
-- requests do not expire and their form starts with the device's SN.
ALTER TABLE feishuDrafts ADD COLUMN kind TEXT NOT NULL DEFAULT 'MESSAGE' CHECK (kind IN ('MESSAGE', 'DEVICE_ALERT'));
ALTER TABLE feishuDrafts ADD COLUMN serialNumber TEXT;
