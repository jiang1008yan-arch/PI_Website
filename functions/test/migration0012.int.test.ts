import { afterEach, beforeEach, expect, it } from "vitest";
import { applyMigrations, createD1 } from "./harness";

// 0012 rebuilds `users` and recreates `piReviewEvents`. Run it over a database
// that already holds data and check nothing is lost or reshaped.

let d1: Awaited<ReturnType<typeof createD1>>;
beforeEach(async () => {
  d1 = await createD1();
});
afterEach(async () => {
  await d1.close();
});

const before0012 = (f: string) => f < "0012";
const only0012 = (f: string) => f.startsWith("0012");

it("keeps users, PIs, items, templates and review history across the rebuild", async () => {
  const { db } = d1;
  await applyMigrations(db, before0012);

  await db.batch([
    db.prepare("INSERT INTO users (id, username, passwordHash, displayName, role) VALUES ('u1', 'admin', 'hash-a', 'Admin', 'ADMIN')"),
    db.prepare("INSERT INTO users (id, username, passwordHash, displayName, role) VALUES ('u2', 'sales', 'hash-s', 'Sales', 'SALES')"),
    db.prepare("INSERT INTO categories (id, code, nameEn, nameZh) VALUES ('c1', 'C1', 'Cat', '类')"),
    db.prepare("INSERT INTO products (id, code, nameEn, nameZh, categoryId, status) VALUES ('p1', 'P1', 'Charger', '充电桩', 'c1', 'ACTIVE')"),
    db.prepare("INSERT INTO productTemplates (id, productId, language, r2Key, uploadedById) VALUES ('t1', 'p1', 'ZH', 'k', 'u1')"),
    db.prepare("INSERT INTO excelTemplates (id, language, r2Key, uploadedById) VALUES ('x1', 'ZH', 'k', 'u1')"),
    db.prepare(
      `INSERT INTO pi (id, language, piNo, seq, status, date, customerCompany, productionOrderNo, createdById, assignedToId, linkedPiNoSnapshot)
       VALUES ('pi1', 'ZH', 'ZH-1', 1, 'APPROVED', '2026-01-01', 'ACME', 'PO-1', 'u2', 'u1', 'EN-1')`
    ),
    db.prepare(
      `INSERT INTO pi (id, language, piNo, seq, status, date, customerCompany, createdById)
       VALUES ('pi2', 'ZH', 'ZH-2', 2, 'PENDING_REVIEW', '2026-01-02', 'Beta', 'u2')`
    ),
    db.prepare("INSERT INTO piItems (id, piId, productId, quantity, unitPrice, discountPct, fieldValues, sortOrder) VALUES ('i1', 'pi1', 'p1', 2, 100, 0, '[]', 0)"),
    db.prepare("INSERT INTO piReviewEvents (id, piId, actorId, action, createdAt) VALUES ('e1', 'pi1', 'u2', 'SUBMITTED', '2026-01-01 08:00:00')"),
    db.prepare("INSERT INTO piReviewEvents (id, piId, actorId, action, createdAt) VALUES ('e2', 'pi1', 'u1', 'APPROVED', '2026-01-01 09:00:00')")
  ]);

  await applyMigrations(db, only0012);

  const users = await db.prepare("SELECT id, passwordHash, role FROM users ORDER BY id").all();
  expect(users.results).toEqual([
    { id: "u1", passwordHash: "hash-a", role: "ADMIN" },
    { id: "u2", passwordHash: "hash-s", role: "SALES" }
  ]);

  const pis = await db.prepare("SELECT id, status, assignedToId, linkedPiNoSnapshot, revisionNo, revisionInProgress, approvedAt FROM pi ORDER BY id").all();
  expect(pis.results).toEqual([
    { id: "pi1", status: "APPROVED", assignedToId: "u1", linkedPiNoSnapshot: "EN-1", revisionNo: 1, revisionInProgress: 0, approvedAt: "2026-01-01 09:00:00" },
    { id: "pi2", status: "PENDING_REVIEW", assignedToId: null, linkedPiNoSnapshot: null, revisionNo: 1, revisionInProgress: 0, approvedAt: null }
  ]);

  expect((await db.prepare("SELECT COUNT(*) AS n FROM piItems").first<{ n: number }>())?.n).toBe(1);
  expect((await db.prepare("SELECT COUNT(*) AS n FROM productTemplates").first<{ n: number }>())?.n).toBe(1);
  expect((await db.prepare("SELECT COUNT(*) AS n FROM excelTemplates").first<{ n: number }>())?.n).toBe(1);

  const events = await db.prepare("SELECT id, action, step, revisionNo FROM piReviewEvents ORDER BY id").all();
  expect(events.results).toEqual([
    { id: "e1", action: "SUBMITTED", step: null, revisionNo: 1 },
    { id: "e2", action: "APPROVED", step: "PRESALES", revisionNo: 1 }
  ]);

  // The new role is accepted; foreign keys still hold.
  await db.prepare("INSERT INTO users (id, username, passwordHash, displayName, role) VALUES ('u3', 'biz', 'h', 'Biz', 'COMMERCE')").run();
  const fk = await db.prepare("PRAGMA foreign_key_check").all();
  expect(fk.results).toEqual([]);
});
