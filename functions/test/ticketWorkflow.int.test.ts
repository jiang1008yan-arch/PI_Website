import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addTicketNote,
  assignTicket,
  changeTicketStatus,
  confirmTicketFault,
  createTicket,
  setTicketCustomer,
  setTicketProduct,
  setTicketType,
  takeTicket,
  updateProgress,
  type FeishuCreateOptions
} from "../lib/ticketWorkflow";
import { setFeishuBookkeeping } from "../lib/feishu/sync";
import { createHarness, seedProduct, type Harness } from "./harness";

// The Ticket workflow at its own interface (CONTEXT.md "Ticket workflow"):
// one batch per change, the status guard, and the ticket changes each verb
// reports for Feishu sync.

let h: Harness;
let productId: string;

beforeEach(async () => {
  h = await createHarness();
  productId = await seedProduct(h.db);
  await h.request("ADMIN", "PUT", "/options/faultType", { values: ["Offline", "Screen fault"] });
});
afterEach(async () => {
  await h.close();
});

const base = { customerCompany: "ACME", orderNo: "PO-1", contactName: "Li", contactInfo: "Feishu" };
const feishuCreate = (opts: FeishuCreateOptions = {}) =>
  createTicket(
    h.env,
    { ...base, initialNote: { actorId: h.users.SERVICE.id, text: "From Feishu: it is off" } },
    { requireProduct: false, creator: h.users.SERVICE, ...opts }
  );
const row = (id: string) => h.db.prepare("SELECT * FROM tickets WHERE id = ?").bind(id).first<any>();
const count = async (sql: string, ...params: unknown[]) => (await h.db.prepare(sql).bind(...params).first<{ n: number }>())!.n;
const timeline = async (id: string) =>
  (await h.db.prepare("SELECT kind, note, statusFrom, statusTo FROM ticketUpdates WHERE ticketId = ? ORDER BY rowid").bind(id).all<any>()).results;

// Someone else writes `sql` between the workflow's read and its batch.
function raceBeforeCommit(db: D1Database, sql: string, ...params: unknown[]): D1Database {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          await target.prepare(sql).bind(...params).run();
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

describe("create", () => {
  it("writes the ticket, its first note and the stored files together", async () => {
    const created = await feishuCreate({ initialFiles: [{ fileName: "a.jpg", contentType: "image/jpeg", size: 3, r2Key: "drafts/a" }] });
    expect(created.changes).toEqual([{ kind: "created" }]);
    expect(await count("SELECT COUNT(*) AS n FROM ticketAttachments WHERE ticketId = ? AND updateId = ?", created.id, created.initialNoteId)).toBe(1);
    expect((await timeline(created.id)).map((u: any) => u.note)).toEqual(["From Feishu: it is off"]);
  });

  it("writes nothing when any part fails", async () => {
    const broken = { fileName: "a.jpg", contentType: "image/jpeg", size: null as unknown as number, r2Key: "drafts/a" };
    await expect(feishuCreate({ initialFiles: [broken], ticketType: "PRODUCT_REQUEST" })).rejects.toThrow();
    expect(await count("SELECT COUNT(*) AS n FROM tickets")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM ticketUpdates")).toBe(0);
  });

  it("a picked product request is classified and reported for the requirement pool", async () => {
    const created = await feishuCreate({ ticketType: "PRODUCT_REQUEST" });
    expect((await row(created.id)).ticketType).toBe("PRODUCT_REQUEST");
    expect(created.changes).toEqual([{ kind: "created" }, { kind: "type", ticketType: "PRODUCT_REQUEST", toPool: true }]);
    expect((await timeline(created.id)).map((u: any) => u.note)).toContain("Ticket type: Product request");
  });

  it("a picked fault type is confirmed but, as before, sends no fault change", async () => {
    const created = await feishuCreate({ ticketType: "FAULT", faultType: "Offline" });
    expect(await row(created.id)).toMatchObject({ ticketType: "FAULT", faultType: "Offline", faultConfirmedById: h.users.SERVICE.id });
    expect(created.changes).toEqual([{ kind: "created" }]);
  });

  it("an invalid pick is skipped and the ticket is still created", async () => {
    const created = await feishuCreate({ ticketType: "FAULT", faultType: "Not on the list" });
    expect(await row(created.id)).toMatchObject({ ticketType: null, faultType: null });
    expect(await timeline(created.id)).toHaveLength(1);
  });

  it("the request card becomes the ticket card only when the creator owns the ticket", async () => {
    const own = await feishuCreate({ feishuCardMessageId: "om_1" });
    expect(own.ownCard).toBe(true);
    expect(await row(own.id)).toMatchObject({ feishuCardMessageId: "om_1", feishuCardOwnerId: h.users.SERVICE.id });

    const other = await createTicket(
      h.env,
      { ...base, assignedServiceId: h.users.ADMIN.id },
      { requireProduct: false, creator: h.users.SERVICE, feishuCardMessageId: "om_2" }
    );
    expect(other.ownCard).toBe(false);
    expect((await row(other.id)).feishuCardMessageId).toBeNull();
  });

  it("links the device alert the ticket came from", async () => {
    await h.db
      .prepare("INSERT INTO deviceStatus (serialNumber, status, lastEventAt, alertKind, alertDraftId) VALUES ('SN1', 'FAULT', '2026-10-28 00:00:00', 'FAULT', 'drf_1')")
      .run();
    const created = await feishuCreate({ alertDraftId: "drf_1" });
    expect((await h.db.prepare("SELECT alertTicketId FROM deviceStatus WHERE serialNumber = 'SN1'").first<any>()).alertTicketId).toBe(created.id);
  });
});

describe("status guard", () => {
  it("moves the status and reports it", async () => {
    const { id } = await feishuCreate();
    expect((await changeTicketStatus(h.db, h.users.SERVICE, id, "IN_PROGRESS")).changes).toEqual([{ kind: "status", to: "IN_PROGRESS" }]);
    expect((await row(id)).status).toBe("IN_PROGRESS");
  });

  it("refuses with 409 and writes nothing when someone else moved the ticket first", async () => {
    const { id } = await feishuCreate();
    const raced = raceBeforeCommit(h.db, "UPDATE tickets SET status = 'IN_PROGRESS' WHERE id = ?", id);
    await expect(changeTicketStatus(raced, h.users.SERVICE, id, "IN_PROGRESS")).rejects.toMatchObject({ status: 409 });
    expect((await timeline(id)).filter((u: any) => u.kind === "STATUS")).toHaveLength(0);
  });

  it("guards the status part of updateProgress, and its note rolls back with it", async () => {
    const { id } = await feishuCreate();
    const raced = raceBeforeCommit(h.db, "UPDATE tickets SET status = 'IN_PROGRESS' WHERE id = ?", id);
    await expect(updateProgress(raced, h.users.SERVICE, id, { status: "IN_PROGRESS", note: "on it" })).rejects.toMatchObject({ status: 409 });
    expect(await timeline(id)).toHaveLength(1);

    await h.db.prepare("UPDATE tickets SET status = 'NEW' WHERE id = ?").bind(id).run();
    const done = await updateProgress(h.db, h.users.SERVICE, id, { status: "IN_PROGRESS", note: "on it" });
    expect(done.changes).toEqual([{ kind: "status", to: "IN_PROGRESS" }, { kind: "note" }]);
    expect((await timeline(id)).slice(1)).toMatchObject([{ kind: "STATUS", statusTo: "IN_PROGRESS" }, { kind: "NOTE", note: "on it" }]);
  });

  it("guards take, whose owner change rolls back with it", async () => {
    const { id } = await createTicket(h.env, base, { requireProduct: false, creator: h.users.ADMIN });
    const raced = raceBeforeCommit(h.db, "UPDATE tickets SET status = 'RESOLVED' WHERE id = ?", id);
    await expect(takeTicket(raced, h.users.SERVICE, id)).rejects.toMatchObject({ status: 409 });
    expect((await row(id)).assignedServiceId).toBe(h.users.ADMIN.id);

    await h.db.prepare("UPDATE tickets SET status = 'NEW' WHERE id = ?").bind(id).run();
    expect((await takeTicket(h.db, h.users.SERVICE, id)).changes).toEqual([{ kind: "taken" }]);
    expect(await row(id)).toMatchObject({ status: "IN_PROGRESS", assignedServiceId: h.users.SERVICE.id });
  });
});

describe("reported changes", () => {
  it("each edit reports what the routes sent before", async () => {
    const { id } = await createTicket(h.env, { ...base, productId }, { requireProduct: false, creator: h.users.SERVICE });
    expect((await addTicketNote(h.db, h.users.SERVICE, id, "called")).changes).toEqual([{ kind: "note" }]);
    expect((await assignTicket(h.db, h.users.SERVICE, id, { assignedServiceId: h.users.ADMIN.id, assignedSalesId: h.users.SALES.id })).changes).toEqual([
      { kind: "assigned", newOwnerIds: [h.users.ADMIN.id, h.users.SALES.id] }
    ]);
    // The user who made the change is not told about it.
    expect((await assignTicket(h.db, h.users.SERVICE, id, { assignedServiceId: h.users.SERVICE.id })).changes).toEqual([{ kind: "assigned", newOwnerIds: [] }]);
    await assignTicket(h.db, h.users.SERVICE, id, { assignedServiceId: h.users.ADMIN.id });
    expect((await assignTicket(h.db, h.users.SERVICE, id, { assignedServiceId: h.users.ADMIN.id })).changes).toEqual([]);
    expect((await setTicketCustomer(h.db, h.users.SERVICE, id, { contactName: "Wang" })).changes).toEqual([{ kind: "product" }]);
    expect((await setTicketCustomer(h.db, h.users.SERVICE, id, { contactName: "Wang" })).changes).toEqual([]);
    expect((await setTicketType(h.db, h.users.SERVICE, id, { ticketType: "PRODUCT_REQUEST" })).changes).toEqual([
      { kind: "type", ticketType: "PRODUCT_REQUEST", toPool: true }
    ]);
    const fault = await confirmTicketFault(h.db, h.users.SERVICE, id, "Offline");
    expect(fault.changes).toEqual([{ kind: "fault", repeat: null }]);
    expect(fault.repeat).toMatchObject({ count: 1, isRepeat: false });
  });

  // Separate decision B: these used to leave no trace on the timeline.
  it("product, model and SN changes are reported and written to the timeline, each that changed", async () => {
    const { id } = await feishuCreate();
    expect((await setTicketProduct(h.db, h.users.SERVICE, id, { productId, productModel: "M-1" })).changes).toEqual([{ kind: "product" }]);
    expect(await row(id)).toMatchObject({ productId, productModel: "M-1" });
    const name = (await h.db.prepare("SELECT COALESCE(NULLIF(nameEn, ''), code) AS name FROM products WHERE id = ?").bind(productId).first<{ name: string }>())!.name;
    expect((await timeline(id)).slice(1)).toMatchObject([
      { kind: "NOTE", note: `Product: (none) → ${name}` },
      { kind: "NOTE", note: "Model: (none) → M-1" }
    ]);
    await setTicketProduct(h.db, h.users.SERVICE, id, { productId, productModel: "M-1" });
    expect(await timeline(id)).toHaveLength(3);
  });
});

// Separate decision A: a repeat fault is noticed however product and fault
// type came together, not only when the fault is confirmed.
describe("repeat faults", () => {
  const withFault = (extra: Record<string, unknown> = {}) =>
    createTicket(h.env, { ...base, productId, ...extra }, {
      requireProduct: false,
      creator: h.users.SERVICE,
      ticketType: "FAULT",
      faultType: "Offline"
    });

  it("a Feishu ticket created with its product and fault type reports the repeat it makes", async () => {
    expect((await withFault()).changes).toEqual([{ kind: "created" }]);
    expect((await withFault()).changes).toEqual([{ kind: "created" }]);
    const third = await withFault();
    expect(third.changes).toMatchObject([{ kind: "created" }, { kind: "repeat", repeat: { count: 3, isRepeat: true } }]);
  });

  it("giving a ticket with a confirmed fault its product reports the repeat it makes, once", async () => {
    await withFault();
    await withFault();
    const other = await seedProduct(h.db, "P2");
    const moved = await withFault({ productId: other });
    expect((await setTicketProduct(h.db, h.users.SERVICE, moved.id, { productId })).changes).toMatchObject([
      { kind: "product" },
      { kind: "repeat", repeat: { count: 3 } }
    ]);
    // Same product again: nothing new came together.
    expect((await setTicketProduct(h.db, h.users.SERVICE, moved.id, { productId, productModel: "M-2" })).changes).toEqual([{ kind: "product" }]);
  });
});

describe("Feishu bookkeeping", () => {
  it("writes only the columns it is given, and not the ticket's updatedAt", async () => {
    const { id } = await feishuCreate();
    await h.db.prepare("UPDATE tickets SET updatedAt = '2026-01-01 00:00:00' WHERE id = ?").bind(id).run();
    const before = await row(id);
    await setFeishuBookkeeping(h.db, [id], { bitableRecordId: "rec_1" });
    expect(await row(id)).toEqual({ ...before, bitableRecordId: "rec_1" });
  });
});
