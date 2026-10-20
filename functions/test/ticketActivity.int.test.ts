import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, createD1, createHarness, seedProduct, type Harness } from "./harness";

// The ticket page's latest status: progress updates with pictures and files,
// follow-up notes on an update, in-place editing of customer and contact, and
// system lines kept apart from people's updates.

let h: Harness;
let ticketId: string;

beforeEach(async () => {
  h = await createHarness();
  const productId = await seedProduct(h.db);
  await h.request("ADMIN", "PUT", "/options/faultType", { values: ["Offline"] });
  ticketId = (await h.request("SERVICE", "POST", "/tickets", { customerCompany: "ACME", orderNo: "PO-1", contactName: "Li", contactInfo: "li@x", productId, answers: {} })).body.id;
});
afterEach(async () => {
  await h.close();
});

const upload = (as: "SERVICE" | "ADMIN" | "SALES", updateId: string, name: string, body: Uint8Array, type = "image/png") =>
  h.fetchAs(as, "POST", `/tickets/${ticketId}/updates/${updateId}/attachments`, body as unknown as BodyInit, { "content-type": type, "x-file-name": encodeURIComponent(name) });

describe("progress updates with attachments", () => {
  it("an update can carry pictures and files that signed-in users download", async () => {
    const note = await h.request("SERVICE", "POST", `/tickets/${ticketId}/notes`, { note: "", withAttachments: true });
    expect(note.status).toBe(200);
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const res = await upload("SERVICE", note.body.id, "现场照片.png", png);
    expect(res.status).toBe(200);
    const att = await res.json<any>();
    expect(att).toMatchObject({ fileName: "现场照片.png", size: 7 });
    await upload("SERVICE", note.body.id, "report.pdf", new Uint8Array([1]), "application/pdf");

    const detail = (await h.request("SALES", "GET", `/tickets/${ticketId}`)).body;
    expect(detail.attachments.map((a: any) => [a.updateId, a.fileName])).toEqual([
      [note.body.id, "现场照片.png"],
      [note.body.id, "report.pdf"]
    ]);

    const download = await h.fetchAs("SALES", "GET", `/tickets/${ticketId}/attachments/${att.id}`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toBe(`attachment; filename*=UTF-8''${encodeURIComponent("现场照片.png")}`);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(png);
    const inline = await h.fetchAs("SALES", "GET", `/tickets/${ticketId}/attachments/${att.id}?inline=1`);
    expect(inline.headers.get("content-disposition")).toMatch(/^inline;/);
    await inline.arrayBuffer();
    // Not public, not for commerce, not across tickets.
    expect((await h.raw("GET", `/tickets/${ticketId}/attachments/${att.id}`, "")).status).toBe(401);
    expect((await h.fetchAs("COMMERCE", "GET", `/tickets/${ticketId}/attachments/${att.id}`)).status).toBe(403);
    expect((await h.fetchAs("SALES", "GET", `/tickets/other/attachments/${att.id}`)).status).toBe(404);
  });

  it("only the author (or an admin) attaches files, within the size limit, to people's updates", async () => {
    const note = (await h.request("SERVICE", "POST", `/tickets/${ticketId}/notes`, { note: "Visited site" })).body.id;
    expect((await upload("SALES", note, "x.png", new Uint8Array([1]))).status).toBe(403);
    expect((await upload("ADMIN", note, "x.png", new Uint8Array([1]))).status).toBe(200);
    expect((await upload("SERVICE", note, "empty.png", new Uint8Array([]))).status).toBe(400);
    expect((await upload("SERVICE", note, "big.bin", new Uint8Array(20 * 1024 * 1024 + 1), "application/octet-stream")).status).toBe(400);
    await h.request("SERVICE", "PATCH", `/tickets/${ticketId}/fault`, { faultType: "Offline" });
    const systemLine = (await h.request("SERVICE", "GET", `/tickets/${ticketId}`)).body.updates.find((u: any) => u.isSystem === 1);
    expect(systemLine.note).toBe("Fault type confirmed: Offline");
    expect((await upload("SERVICE", systemLine.id, "x.png", new Uint8Array([1]))).status).toBe(400);
    // Text is still required when nothing will be attached.
    expect((await h.request("SERVICE", "POST", `/tickets/${ticketId}/notes`, { note: " " })).status).toBe(400);
  });

  it("a follow-up is added to an update, one level deep", async () => {
    const first = (await h.request("SERVICE", "POST", `/tickets/${ticketId}/notes`, { note: "Replaced the module" })).body.id;
    const follow = (await h.request("SERVICE", "POST", `/tickets/${ticketId}/notes`, { note: "Customer confirmed it works", parentId: first })).body.id;
    const nested = (await h.request("SERVICE", "POST", `/tickets/${ticketId}/notes`, { note: "And again", parentId: follow })).body.id;
    const updates = (await h.request("SERVICE", "GET", `/tickets/${ticketId}`)).body.updates;
    expect(updates.find((u: any) => u.id === follow).parentId).toBe(first);
    expect(updates.find((u: any) => u.id === nested).parentId).toBe(first);
    expect((await h.request("SERVICE", "POST", `/tickets/${ticketId}/notes`, { note: "x", parentId: "tup_missing" })).status).toBe(400);
  });
});

describe("editing customer and contact in place", () => {
  it("each changed field is saved and logged; contact fields cannot be emptied", async () => {
    await h.request("SERVICE", "PATCH", `/tickets/${ticketId}/customer`, { contactName: "Ana", contactInfo: "li@x" });
    const detail = (await h.request("SERVICE", "GET", `/tickets/${ticketId}`)).body;
    expect(detail.ticket).toMatchObject({ contactName: "Ana", contactInfo: "li@x" });
    const lines = detail.updates.filter((u: any) => u.isSystem === 1).map((u: any) => u.note);
    expect(lines).toEqual(["Contact name: Li → Ana"]);
    expect((await h.request("SERVICE", "PATCH", `/tickets/${ticketId}/customer`, { contactInfo: " " })).body.error).toBe("Contact details cannot be empty.");
    expect((await h.request("SALES", "PATCH", `/tickets/${ticketId}/customer`, { contactName: "X" })).status).toBe(403);
  });
});

describe("migration 0018", () => {
  it("marks earlier system-written lines", async () => {
    const { db, close } = await createD1();
    try {
      await applyMigrations(db, (f) => f < "0018");
      for (const [id, note] of [["u1", "Fault type confirmed: Offline"], ["u2", "Replaced the module"], ["u3", "After-sales owner: A → B (changed by A)"]]) {
        await db.prepare("INSERT INTO ticketUpdates (id, ticketId, actorId, kind, note) VALUES (?, 't', 'a', 'NOTE', ?)").bind(id, note).run();
      }
      await applyMigrations(db, (f) => f.startsWith("0018"));
      const rows = await db.prepare("SELECT id, isSystem FROM ticketUpdates ORDER BY id").all<any>();
      expect(rows.results).toEqual([{ id: "u1", isSystem: 1 }, { id: "u2", isSystem: 0 }, { id: "u3", isSystem: 1 }]);
    } finally {
      await close();
    }
  });
});
