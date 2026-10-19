import { describe, expect, it } from "vitest";
import { triageMessages } from "../aiTriage";
import type { Env } from "../types";
import { draftCard, ticketCard, type TicketCardData } from "./cards";
import { messageContentToText } from "./client";
import { decryptPayload, readIncoming, sha256Hex, verifySignature } from "./crypto";

// Encrypts like Feishu does: base64(iv ‖ AES-256-CBC(text)), key = SHA-256(encryptKey).
async function feishuEncrypt(text: string, encryptKey: string): Promise<string> {
  const keyBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encryptKey));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv }, key, new TextEncoder().encode(text)));
  const all = new Uint8Array(16 + cipher.length);
  all.set(iv);
  all.set(cipher, 16);
  return btoa(String.fromCharCode(...all));
}

describe("Feishu push authentication", () => {
  const encryptKey = "test-encrypt-key";

  it("decrypts an encrypted payload", async () => {
    const encrypted = await feishuEncrypt('{"hello":"世界"}', encryptKey);
    expect(JSON.parse(await decryptPayload(encrypted, encryptKey))).toEqual({ hello: "世界" });
  });

  it("checks the request signature over timestamp + nonce + key + body", async () => {
    const body = '{"encrypt":"x"}';
    const signature = await sha256Hex("1700000000" + "nonce" + encryptKey + body);
    expect(await verifySignature({ timestamp: "1700000000", nonce: "nonce", signature }, body, encryptKey)).toBe(true);
    expect(await verifySignature({ timestamp: "1700000000", nonce: "nonce", signature }, body + " ", encryptKey)).toBe(false);
    expect(await verifySignature({ timestamp: null, nonce: "nonce", signature }, body, encryptKey)).toBe(false);
  });

  it("accepts a signed, encrypted push with the right verification token", async () => {
    const inner = JSON.stringify({ schema: "2.0", header: { token: "vt", event_type: "x" }, event: {} });
    const body = JSON.stringify({ encrypt: await feishuEncrypt(inner, encryptKey) });
    const signature = await sha256Hex("1" + "n" + encryptKey + body);
    const result = await readIncoming(body, { timestamp: "1", nonce: "n", signature }, { encryptKey, verificationToken: "vt" });
    expect(result).toEqual({ ok: true, payload: JSON.parse(inner) });
  });

  it("rejects bad signatures, wrong tokens, and anything when unconfigured", async () => {
    const inner = JSON.stringify({ header: { token: "vt" } });
    const body = JSON.stringify({ encrypt: await feishuEncrypt(inner, encryptKey) });
    expect((await readIncoming(body, { timestamp: "1", nonce: "n", signature: "00" }, { encryptKey })).ok).toBe(false);
    expect((await readIncoming(JSON.stringify({ header: { token: "other" } }), { timestamp: null, nonce: null, signature: null }, { verificationToken: "vt" })).ok).toBe(false);
    expect((await readIncoming(JSON.stringify({ header: { token: "vt" } }), { timestamp: null, nonce: null, signature: null }, {})).ok).toBe(false);
    expect((await readIncoming("not json", { timestamp: null, nonce: null, signature: null }, { verificationToken: "vt" })).ok).toBe(false);
  });
});

describe("message text", () => {
  it("reads text and rich-text messages and drops mention placeholders", () => {
    expect(messageContentToText("text", '{"text":"@_user_1 charger   offline since Monday"}')).toBe("charger offline since Monday");
    expect(
      messageContentToText("post", JSON.stringify({ title: "Issue", content: [[{ tag: "text", text: "Screen " }, { tag: "at", user_id: "x" }, { tag: "text", text: "black" }]] }))
    ).toBe("Issue\nScreen black");
    expect(messageContentToText("image", '{"image_key":"k"}')).toBe("");
  });
});

const ticket: TicketCardData = {
  id: "tkt_1",
  ticketNo: "TK-1",
  status: "NEW",
  customerCompany: "Iberia *Charge*",
  orderNo: "PO-1",
  contactName: "Ana *x*",
  productName: "AC 7kW",
  productModel: null,
  serialNumber: null,
  faultType: null,
  serviceName: null,
  salesName: "Dev Sales",
  latestNote: null
};

const elementsOf = (card: any): any[] => card.body.elements;
const flat = (els: any[]): any[] => els.flatMap((e) => [e, ...flat(e.elements ?? [])]);

describe("cards", () => {
  it("a new ticket card can be taken and updated, and is shared/updatable", () => {
    const card = ticketCard(ticket, "https://portal.example");
    expect(card.schema).toBe("2.0");
    expect(card.config.update_multi).toBe(true);
    const all = flat(elementsOf(card));
    const callbacks = all.filter((e) => e.tag === "button").map((b) => b.behaviors[0].value);
    expect(callbacks).toEqual([{ action: "take", ticketId: "tkt_1" }, { action: "update", ticketId: "tkt_1" }]);
    expect(all.find((e) => e.tag === "select_static").options.map((o: any) => o.value)).toEqual(["IN_PROGRESS"]);
    // Customer-supplied text in markdown is escaped, not formatted.
    const facts = all.find((e) => e.tag === "markdown").content as string;
    expect(facts).toContain("**Contact:** Ana \\*x\\*");
    expect(all.some((e) => e.tag === "markdown" && e.content.includes("https://portal.example/tickets/tkt_1"))).toBe(true);
  });

  it("closed tickets offer no actions", () => {
    const all = flat(elementsOf(ticketCard({ ...ticket, status: "CLOSED" }, null)));
    expect(all.some((e) => e.tag === "button" || e.tag === "form")).toBe(false);
  });

  it("the draft card pre-selects the AI fault type only when it is on the list", () => {
    const withAi = flat(elementsOf(draftCard({ draftId: "d1", text: "hi", aiSummary: "Offline", aiFaultType: "Offline", faultTypes: ["Offline", "Screen"] })));
    expect(withAi.find((e) => e.tag === "select_static").initial_option).toBe("Offline");
    const unknown = flat(elementsOf(draftCard({ draftId: "d1", text: "hi", aiSummary: null, aiFaultType: "Made up", faultTypes: ["Offline"] })));
    expect(unknown.find((e) => e.tag === "select_static").initial_option).toBeUndefined();
    expect(withAi.find((e) => e.tag === "button").behaviors[0].value).toEqual({ action: "confirm_draft", draftId: "d1" });
  });
});

describe("AI triage", () => {
  const env = {} as Env;
  const fakeClient = (result: unknown) => ({ beta: { messages: { parse: async () => result } } }) as any;

  it("returns nothing without an API key or client", async () => {
    expect(await triageMessages(env, "x", ["Offline"])).toBeNull();
  });

  it("keeps the fault type only if it is on the list", async () => {
    const ok = await triageMessages(env, "x", ["Offline"], fakeClient({ stop_reason: "end_turn", parsed_output: { summary: " Charger offline. ", faultType: "Offline" } }));
    expect(ok).toEqual({ summary: "Charger offline.", faultType: "Offline" });
    const none = await triageMessages(env, "x", ["Offline"], fakeClient({ stop_reason: "end_turn", parsed_output: { summary: "s", faultType: "none" } }));
    expect(none).toEqual({ summary: "s", faultType: null });
  });

  it("degrades to no suggestion on refusal or error", async () => {
    expect(await triageMessages(env, "x", [], fakeClient({ stop_reason: "refusal", parsed_output: null }))).toBeNull();
    const failing = { beta: { messages: { parse: async () => { throw new Error("down"); } } } } as any;
    expect(await triageMessages(env, "x", [], failing)).toBeNull();
  });
});
