import { integer, real, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("passwordHash").notNull(),
  displayName: text("displayName").notNull(),
  role: text("role", { enum: ["ADMIN", "USER"] }).notNull(),
  createdAt: text("createdAt").notNull()
});

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  nameEn: text("nameEn").notNull(),
  nameZh: text("nameZh").notNull()
});

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  nameEn: text("nameEn").notNull(),
  nameZh: text("nameZh").notNull(),
  categoryId: text("categoryId").notNull(),
  status: text("status", { enum: ["ACTIVE", "DISCONTINUED"] }).notNull()
});

export const productTemplates = sqliteTable("productTemplates", {
  id: text("id").primaryKey(),
  productId: text("productId").notNull(),
  language: text("language", { enum: ["EN", "ZH"] }).notNull(),
  r2Key: text("r2Key").notNull(),
  uploadedById: text("uploadedById").notNull(),
  uploadedAt: text("uploadedAt").notNull()
}, (t) => ({ uniq: unique().on(t.productId, t.language) }));

export const productFields = sqliteTable("productFields", {
  id: text("id").primaryKey(),
  productId: text("productId").notNull(),
  language: text("language", { enum: ["EN", "ZH"] }).notNull(),
  label: text("label").notNull(),
  fieldType: text("fieldType", { enum: ["TEXT", "DROPDOWN"] }).notNull(),
  options: text("options"),
  defaultValue: text("defaultValue"),
  sortOrder: integer("sortOrder").notNull()
});

export const pi = sqliteTable("pi", {
  id: text("id").primaryKey(),
  language: text("language", { enum: ["EN", "ZH"] }).notNull(),
  piNo: text("piNo").notNull().unique(),
  seq: integer("seq").notNull(),
  status: text("status").notNull(),
  date: text("date").notNull(),
  customerCompany: text("customerCompany").notNull(),
  customerContact: text("customerContact"),
  customerEmail: text("customerEmail"),
  customerPhone: text("customerPhone"),
  customerCountry: text("customerCountry"),
  customerAddress: text("customerAddress"),
  validUntil: text("validUntil"),
  incoterm: text("incoterm"),
  shipmentMode: text("shipmentMode"),
  paymentTerm: text("paymentTerm"),
  productionOrderNo: text("productionOrderNo"),
  customerSource: text("customerSource"),
  customerType: text("customerType"),
  deliveryDate: text("deliveryDate"),
  rejectionNote: text("rejectionNote"),
  assignedToId: text("assignedToId"),
  submittedSnapshot: text("submittedSnapshot"),
  createdById: text("createdById").notNull(),
  createdAt: text("createdAt").notNull(),
  updatedAt: text("updatedAt").notNull(),
  archivedAt: text("archivedAt")
});

export const piItems = sqliteTable("piItems", {
  id: text("id").primaryKey(),
  piId: text("piId").notNull(),
  productId: text("productId").notNull(),
  quantity: real("quantity").notNull(),
  unitPrice: real("unitPrice").notNull(),
  discountPct: real("discountPct").notNull(),
  fieldValues: text("fieldValues").notNull(),
  sortOrder: integer("sortOrder").notNull()
});

export const piReviewEvents = sqliteTable("piReviewEvents", {
  id: text("id").primaryKey(),
  piId: text("piId").notNull(),
  actorId: text("actorId").notNull(),
  action: text("action", { enum: ["SUBMITTED", "APPROVED", "REJECTED"] }).notNull(),
  note: text("note"),
  createdAt: text("createdAt").notNull()
});

export const piNumberSequences = sqliteTable("piNumberSequences", {
  date: text("date").primaryKey(),
  lastSeq: integer("lastSeq").notNull()
});
