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
  type FeishuPerson
} from "../lib/feishu/ticketRequest";
import { sqlTime } from "../lib/db";
import { addTicketNote, createTicket, type RequestClaim } from "../lib/ticketWorkflow";
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

  // Separate decision E: an expired Add to ticket is told apart, so the card
  // and the toast speak of 30 minutes and Save to ticket, not of 6 hours.
  it("an Add to ticket past its 30 minutes is refused as an expired addition", async () => {
    const ticket = await newTicket();
    const { draft } = await openAddition(h.env, alice.unionId, ticket.id, new Date(now.getTime() - 31 * 60 * 1000));
    expect(await openRequestFor(h.db, draft.id, alice, null, now)).toEqual({ refused: "additionExpired" });
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

// Decision D (docs/plans/2026-10-28-ticket-request.md): a Worker that stops
// half-way never leaves a request claimed for good, nor makes two tickets.
describe("claims left behind", () => {
  const minutesAgo = (m: number) => sqlTime(new Date(now.getTime() - m * 60 * 1000));
  const ticketFor = (claim: RequestClaim) =>
    createTicket(h.env, { customerCompany: "ACME", orderNo: "PO-1", contactName: "Li", contactInfo: "Feishu" }, {
      requireProduct: false,
      creator: h.users.SERVICE,
      request: claim
    });
  const tickets = async () => (await h.db.prepare("SELECT COUNT(*) AS n FROM tickets").first<{ n: number }>())!.n;
  const leaveClaim = (draftId: string, claimedAt: string | null) =>
    h.db.prepare("UPDATE feishuDrafts SET ticketId = 'CREATING', claimedAt = ? WHERE id = ?").bind(claimedAt, draftId).run();

  it("a fresh claim still counts as made; one left for minutes, or from before claims were dated, is open again", async () => {
    const draft = await openFor(alice);
    await leaveClaim(draft.id, minutesAgo(1));
    expect(await openRequestFor(h.db, draft.id, alice, null, now)).toEqual({ refused: "created" });
    expect(await createTicketFromRequest(h.db, draft.id, ticketFor, now)).toBeNull();

    await leaveClaim(draft.id, minutesAgo(3));
    expect(await openRequestFor(h.db, draft.id, alice, null, now)).toMatchObject({ draft: { id: draft.id } });
    const created = await createTicketFromRequest(h.db, draft.id, ticketFor, now);
    expect(await request(draft.id)).toMatchObject({ ticketId: created!.id, claimedAt: null });

    const legacy = await openFor(bob);
    await leaveClaim(legacy.id, null);
    expect(await openRequestFor(h.db, legacy.id, bob, null, now)).toMatchObject({ draft: { id: legacy.id } });
  });

  it("the ticket and its link are made together, so stopping right after leaves nothing to redo", async () => {
    const draft = await openFor(alice);
    const stopped = createTicketFromRequest(
      h.db,
      draft.id,
      async (claim) => {
        await ticketFor(claim);
        throw new Error("Worker stopped");
      },
      now
    );
    await expect(stopped).rejects.toThrow("Worker stopped");
    expect((await request(draft.id)).ticketId).toMatch(/^tkt_/);
    expect(await createTicketFromRequest(h.db, draft.id, ticketFor, new Date(now.getTime() + 10 * 60 * 1000))).toBeNull();
    expect(await tickets()).toBe(1);
  });

  it("a slow first attempt whose claim was taken over makes no second ticket", async () => {
    const draft = await openFor(alice);
    let second: unknown;
    const first = createTicketFromRequest(
      h.db,
      draft.id,
      async (claim) => {
        // Meanwhile the claim goes stale and the next press takes it over.
        await h.db.prepare("UPDATE feishuDrafts SET claimedAt = ? WHERE id = ?").bind(minutesAgo(5), draft.id).run();
        second = await createTicketFromRequest(h.db, draft.id, ticketFor, now);
        return await ticketFor(claim);
      },
      now
    );
    await expect(first).rejects.toMatchObject({ status: 409, message: "A ticket was already created for this." });
    expect((await request(draft.id)).ticketId).toBe((second as { id: string }).id);
    expect(await tickets()).toBe(1);
  });

  it("Save to ticket saves the note and links it together, too", async () => {
    const ticket = await newTicket();
    const { draft } = await openAddition(h.env, alice.unionId, ticket.id, now);
    const stopped = saveToTicket(
      h.db,
      draft,
      async (claim) => {
        await addTicketNote(h.db, h.users.SERVICE, ticket.id, "photos", { withAttachments: true, request: claim });
        throw new Error("Worker stopped");
      },
      now
    );
    await expect(stopped).rejects.toThrow("Worker stopped");
    expect((await request(draft.id)).ticketId).toBe(ticket.id);
    expect(await saveToTicket(h.db, draft, async () => "again", new Date(now.getTime() + 10 * 60 * 1000))).toBeNull();
    expect((await h.db.prepare("SELECT COUNT(*) AS n FROM ticketUpdates WHERE ticketId = ? AND note = 'photos'").bind(ticket.id).first<{ n: number }>())!.n).toBe(1);
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
