CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  displayName TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'USER')),
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  nameEn TEXT NOT NULL,
  nameZh TEXT NOT NULL
);
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  nameEn TEXT NOT NULL,
  nameZh TEXT NOT NULL,
  categoryId TEXT NOT NULL REFERENCES categories(id),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DISCONTINUED'))
);
CREATE TABLE productTemplates (
  id TEXT PRIMARY KEY,
  productId TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  language TEXT NOT NULL CHECK (language IN ('EN', 'ZH')),
  r2Key TEXT NOT NULL,
  uploadedById TEXT NOT NULL REFERENCES users(id),
  uploadedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(productId, language)
);
CREATE TABLE productFields (
  id TEXT PRIMARY KEY,
  productId TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  language TEXT NOT NULL CHECK (language IN ('EN', 'ZH')),
  label TEXT NOT NULL,
  fieldType TEXT NOT NULL CHECK (fieldType IN ('TEXT', 'DROPDOWN')),
  options TEXT,
  defaultValue TEXT,
  sortOrder INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE pi (
  id TEXT PRIMARY KEY,
  language TEXT NOT NULL CHECK (language IN ('EN', 'ZH')),
  piNo TEXT NOT NULL UNIQUE,
  seq INTEGER NOT NULL,
  status TEXT NOT NULL,
  date TEXT NOT NULL,
  customerCompany TEXT NOT NULL,
  customerContact TEXT,
  customerEmail TEXT,
  customerPhone TEXT,
  customerCountry TEXT,
  customerAddress TEXT,
  validUntil TEXT,
  incoterm TEXT,
  shipmentMode TEXT,
  paymentTerm TEXT,
  productionOrderNo TEXT,
  customerSource TEXT,
  customerType TEXT,
  deliveryDate TEXT,
  rejectionNote TEXT,
  createdById TEXT NOT NULL REFERENCES users(id),
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archivedAt TEXT
);
CREATE TABLE piItems (
  id TEXT PRIMARY KEY,
  piId TEXT NOT NULL REFERENCES pi(id) ON DELETE CASCADE,
  productId TEXT NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL,
  unitPrice REAL NOT NULL,
  discountPct REAL NOT NULL DEFAULT 0,
  fieldValues TEXT NOT NULL,
  sortOrder INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE piReviewEvents (
  id TEXT PRIMARY KEY,
  piId TEXT NOT NULL REFERENCES pi(id) ON DELETE CASCADE,
  actorId TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN ('SUBMITTED', 'APPROVED', 'REJECTED')),
  note TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE contractTemplates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('EN', 'ZH', 'BOTH')),
  r2Key TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploadedById TEXT NOT NULL REFERENCES users(id),
  uploadedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE excelTemplates (
  id TEXT PRIMARY KEY,
  language TEXT NOT NULL UNIQUE CHECK (language IN ('EN', 'ZH')),
  r2Key TEXT NOT NULL,
  anchorCellName TEXT NOT NULL DEFAULT 'PRODUCTS_START',
  uploadedById TEXT NOT NULL REFERENCES users(id),
  uploadedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE senderProfile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  corp TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  fromName TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT ''
);
