import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimAlert,
  createTicketFromRequest,
  dismissRequest,
  getOrOpenDraft,
  openAddition,
  openDeviceAlert,
  openRequestFor,
  saveToTicket,
  setRequestCard,
  sqlTime,
  type FeishuPerson
} from "../lib/feishu/ticketRequest";
import { createTicket } from "../lib/ticketWorkflow";
import { createHarness, type Harness } from "./harness";

// The Ticket request lifecycle at its own interface (CONTEXT.md "Ticket
// request lifecycle"): the open-request guard, the claim that turns a request
// into a ticket, Save to ticket, and device alerts.

let h: Harness;
const now = new Date("2026-10-28T12:00:00Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);
const alice: FeishuPerson = { unionId: "on_alice", openId: "ou_alice" };
const bob: FeishuPerson = { unionId: "on_bob", openId: "ou_bob" };

beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

const request = (id: string) => h.db.prepare("SELECT * FROM feishuDrafts WHERE id = ?").bind(id).first<any>();
const openFor = async (person: FeishuPerson, at = now) => (await getOrOpenDraft(h.env, person.unionId, at)).draft;
const newTicket = () =>
  createTicket(h.env, { customerCompany: "ACME", orderNo: "PO-1", contactName: "Li", contactInfo: "Feishu" }, {
    requireProduct: false,
    validateQuestionnaire: false,
    creator: h.users.SERVICE
  });
const deviceAlert = async (serialNumber = "SN1", card = "om_group") => {
  await h.db.prepare("INSERT INTO deviceStatus (serialNumber, status, lastEventAt) VALUES (?, 'FAULT', ?)").bind(serialNumber, sqlTime(now)).run();
  const draftId = `fdr_${serialNumber}`;
  await openDeviceAlert(h.db, { draftId, serialNumber, text: `Device alert: SN ${serialNumber}` }, async () => card, now);
  return draftId;
};

describe("open request guard", () => {
  it("gives the request to its owner and a reason to everyone else", async () => {
    const draft = await openFor(alice);
    expect(await openRequestFor(h.db, draft.id, alice, null, now)).toMatchObject({ draft: { id: draft.id } });
    expect(await openRequestFor(h.db, draft.id, bob, null, now)).toEqual({ refused: "notYours" });
    expect(await openRequestFor(h.db, "fdr_missing", alice, null, now)).toEqual({ refused: "gone" });
  });

  it("refuses a discarded request and one that became a ticket", async () => {
    const discarded = await openFor(alice);
    await dismissRequest(h.db, discarded.id, now);
    expect(await openRequestFor(h.db, discarded.id, alice, null, now)).toEqual({ refused: "discarded" });

    const created = await openFor(alice);
    await createTicketFromRequest(h.db, created.id, newTicket);
    expect(await openRequestFor(h.db, created.id, alice, null, now)).toEqual({ refused: "created" });
  });

  it("records a request past its time limit as expired, once", async () => {
    const draft = await openFor(alice, hoursAgo(7));
    expect(await openRequestFor(h.db, draft.id, alice, null, now)).toEqual({ refused: "expired" });
    expect((await request(draft.id)).expiredAt).toBe(sqlTime(now));

    const later = new Date(now.getTime() + 60_000);
    expect(await openRequestFor(h.db, draft.id, alice, null, later)).toEqual({ refused: "expired" });
    expect((await request(draft.id)).expiredAt).toBe(sqlTime(now));
  });

  it("an unclaimed device alert may only be opened; once taken, its group card points to the private chat", async () => {
    const draftId = await deviceAlert();
    expect(await openRequestFor(h.db, draftId, bob, "om_group", now)).toEqual({ refused: "unclaimed" });
    expect(await openRequestFor(h.db, draftId, bob, "om_group", now, { allowUnclaimedAlert: true })).toMatchObject({ draft: { id: draftId } });

    expect(await claimAlert(h.db, draftId, alice.unionId, now)).toBe("taken");
    await setRequestCard(h.db, draftId, "om_private");
    expect(await openRequestFor(h.db, draftId, alice, "om_group", now)).toEqual({ refused: "inPrivate" });
    expect(await openRequestFor(h.db, draftId, alice, "om_private", now)).toMatchObject({ draft: { id: draftId } });
  });
});

describe("create from a request", () => {
  it("claims the request while the ticket is created, then links it; a second press creates nothing", async () => {
    const draft = await openFor(alice);
    let second: unknown = "not run";
    const created = await createTicketFromRequest(h.db, draft.id, async () => {
      expect((await request(draft.id)).ticketId).toBe("CREATING");
      second = await createTicketFromRequest(h.db, draft.id, newTicket);
      return await newTicket();
    });
    expect(second).toBeNull();
    expect((await request(draft.id)).ticketId).toBe(created!.id);
    expect(await createTicketFromRequest(h.db, draft.id, newTicket)).toBeNull();
    expect((await h.db.prepare("SELECT COUNT(*) AS n FROM tickets").first<{ n: number }>())!.n).toBe(1);
  });

  it("releases the claim when creating fails, so it can be tried again", async () => {
    const draft = await openFor(alice);
    await expect(createTicketFromRequest(h.db, draft.id, () => Promise.reject(new Error("refused")))).rejects.toThrow("refused");
    expect((await request(draft.id)).ticketId).toBeNull();
    const created = await createTicketFromRequest(h.db, draft.id, newTicket);
    expect((await request(draft.id)).ticketId).toBe(created!.id);
  });
});

describe("save to ticket", () => {
  it("saves once, and releases the claim when saving fails", async () => {
    const ticket = await newTicket();
    const { draft } = await openAddition(h.env, alice.unionId, ticket.id, now);

    await expect(saveToTicket(h.db, draft, () => Promise.reject(new Error("refused")))).rejects.toThrow("refused");
    expect((await request(draft.id)).ticketId).toBeNull();

    expect(await saveToTicket(h.db, draft, async () => "saved")).toBe("saved");
    expect((await request(draft.id)).ticketId).toBe(ticket.id);
    expect(await saveToTicket(h.db, draft, async () => "saved twice")).toBeNull();
  });
});

describe("device alerts", () => {
  it("opens an unclaimed request with its card, linked from the device", async () => {
    const draftId = await deviceAlert("SN1", "om_1");
    expect(await request(draftId)).toMatchObject({ kind: "DEVICE_ALERT", requestedBy: "", serialNumber: "SN1", cardMessageId: "om_1" });
    expect((await h.db.prepare("SELECT alertDraftId FROM deviceStatus WHERE serialNumber = 'SN1'").first<any>()).alertDraftId).toBe(draftId);
  });

  it("does not link the device when the card could not be sent", async () => {
    await h.db.prepare("INSERT INTO deviceStatus (serialNumber, status, lastEventAt) VALUES ('SN2', 'FAULT', ?)").bind(sqlTime(now)).run();
    const failed = openDeviceAlert(h.db, { draftId: "fdr_SN2", serialNumber: "SN2", text: "Device alert" }, () => Promise.reject(new Error("Feishu down")), now);
    await expect(failed).rejects.toThrow("Feishu down");
    expect((await h.db.prepare("SELECT alertDraftId FROM deviceStatus WHERE serialNumber = 'SN2'").first<any>()).alertDraftId).toBeNull();
  });

  it("is taken by the first presser who has no other open request", async () => {
    const draftId = await deviceAlert("SN1");
    await openFor(bob);
    expect(await claimAlert(h.db, draftId, bob.unionId, now)).toBe("busy");
    expect(await claimAlert(h.db, draftId, alice.unionId, now)).toBe("taken");
    expect(await claimAlert(h.db, draftId, "on_carol", now)).toBe("takenByOther");
    expect(await request(draftId)).toMatchObject({ requestedBy: alice.unionId, updatedAt: sqlTime(now) });
  });
});
