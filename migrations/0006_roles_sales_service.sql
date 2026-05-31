-- Rename the sales role USER -> SALES and add the new after-sales role SERVICE.
-- SQLite cannot ALTER a CHECK constraint, so the users table is rebuilt.
--
-- D1 keeps foreign key enforcement on during migrations. Rebuilding a parent
-- table that already has child rows can fail at commit time, even when the
-- final table contents are equivalent. Move the child rows out of the way
-- first, rebuild users, then restore them.

CREATE TABLE migration_0006_productTemplates AS SELECT * FROM productTemplates;
CREATE TABLE migration_0006_contractTemplates AS SELECT * FROM contractTemplates;
CREATE TABLE migration_0006_excelTemplates AS SELECT * FROM excelTemplates;
CREATE TABLE migration_0006_pi AS SELECT * FROM pi;
CREATE TABLE migration_0006_piItems AS SELECT * FROM piItems;
CREATE TABLE migration_0006_piReviewEvents AS SELECT * FROM piReviewEvents;

DELETE FROM productTemplates;
DELETE FROM contractTemplates;
DELETE FROM excelTemplates;
DELETE FROM piReviewEvents;
DELETE FROM piItems;
DELETE FROM pi;

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  displayName TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'SALES', 'SERVICE')),
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users_new (id, username, passwordHash, displayName, role, createdAt)
  SELECT id, username, passwordHash, displayName,
         CASE role WHEN 'USER' THEN 'SALES' ELSE role END,
         createdAt
  FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

INSERT INTO productTemplates (id, productId, language, r2Key, uploadedById, uploadedAt)
  SELECT id, productId, language, r2Key, uploadedById, uploadedAt
  FROM migration_0006_productTemplates;

INSERT INTO contractTemplates (id, name, language, r2Key, size, uploadedById, uploadedAt)
  SELECT id, name, language, r2Key, size, uploadedById, uploadedAt
  FROM migration_0006_contractTemplates;

INSERT INTO excelTemplates (id, language, r2Key, anchorCellName, uploadedById, uploadedAt)
  SELECT id, language, r2Key, anchorCellName, uploadedById, uploadedAt
  FROM migration_0006_excelTemplates;

INSERT INTO pi (
  id,
  language,
  piNo,
  seq,
  status,
  date,
  customerCompany,
  customerContact,
  customerEmail,
  customerPhone,
  customerCountry,
  customerAddress,
  validUntil,
  incoterm,
  shipmentMode,
  paymentTerm,
  productionOrderNo,
  customerSource,
  customerType,
  deliveryDate,
  rejectionNote,
  createdById,
  createdAt,
  updatedAt,
  archivedAt,
  assignedToId,
  senderCorp,
  senderAddress,
  senderFrom,
  senderPhone,
  senderEmail,
  otherRequirements,
  submittedSnapshot
)
  SELECT
    id,
    language,
    piNo,
    seq,
    status,
    date,
    customerCompany,
    customerContact,
    customerEmail,
    customerPhone,
    customerCountry,
    customerAddress,
    validUntil,
    incoterm,
    shipmentMode,
    paymentTerm,
    productionOrderNo,
    customerSource,
    customerType,
    deliveryDate,
    rejectionNote,
    createdById,
    createdAt,
    updatedAt,
    archivedAt,
    assignedToId,
    senderCorp,
    senderAddress,
    senderFrom,
    senderPhone,
    senderEmail,
    otherRequirements,
    submittedSnapshot
  FROM migration_0006_pi;

INSERT INTO piItems (id, piId, productId, quantity, unitPrice, discountPct, fieldValues, sortOrder)
  SELECT id, piId, productId, quantity, unitPrice, discountPct, fieldValues, sortOrder
  FROM migration_0006_piItems;

INSERT INTO piReviewEvents (id, piId, actorId, action, note, createdAt)
  SELECT id, piId, actorId, action, note, createdAt
  FROM migration_0006_piReviewEvents;

DROP TABLE migration_0006_productTemplates;
DROP TABLE migration_0006_contractTemplates;
DROP TABLE migration_0006_excelTemplates;
DROP TABLE migration_0006_pi;
DROP TABLE migration_0006_piItems;
DROP TABLE migration_0006_piReviewEvents;
