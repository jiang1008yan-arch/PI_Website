import { describe, expect, it } from "vitest";
import { maskApiKey, openApiKey, sealApiKey } from "../aiKeys";
import { redactKey, testAiKey, triageMessages, type AiConfig } from "../aiTriage";
import { draftCard, ticketCard, type TicketCardData } from "./cards";
import { messageContentToText } from "./client";
import { decryptPayload, readIncoming, sha256Hex, verifySignature } from "./crypto";
import { checkPoolFields, parsePoolUrl, poolRecordFields, POOL_FIELDS } from "./requirementPool";

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

  it("Take is offered only while nobody owns the ticket", () => {
    const owned = flat(elementsOf(ticketCard({ ...ticket, serviceName: "Dev Service", status: "IN_PROGRESS" }, null)));
    expect(owned.filter((e) => e.tag === "button").map((b) => b.behaviors[0].value.action)).toEqual(["update"]);
    const facts = owned.find((e) => e.tag === "markdown").content as string;
    expect(facts).toContain("**Type:** not classified");
    const fault = flat(elementsOf(ticketCard({ ...ticket, ticketType: "FAULT", faultType: "Offline" }, null)));
    expect(fault.find((e) => e.tag === "markdown").content).toContain("**Type:** Fault · Offline");
  });

  it("the draft card pre-fills AI suggestions only when they are valid", () => {
    const withAi = flat(
      elementsOf(draftCard({ draftId: "d1", text: "hi", aiSummary: "离线", aiTicketType: "FAULT", aiFaultType: "Offline", faultTypes: ["Offline", "Screen"] }))
    );
    const select = (els: any[], name: string) => els.find((e) => e.tag === "select_static" && e.name === name);
    expect(select(withAi, "faultType").initial_option).toBe("Offline");
    expect(select(withAi, "ticketType").initial_option).toBe("FAULT");
    expect(select(withAi, "ticketType").options.map((o: any) => o.value)).toEqual(["FAULT", "PRODUCT_REQUEST", "OTHER"]);
    expect(withAi.find((e) => e.tag === "input" && e.name === "summary").default_value).toBe("离线");
    const unknown = flat(elementsOf(draftCard({ draftId: "d1", text: "hi", aiSummary: null, aiTicketType: "MADE_UP", aiFaultType: "Made up", faultTypes: ["Offline"] })));
    expect(select(unknown, "faultType").initial_option).toBeUndefined();
    expect(select(unknown, "ticketType").initial_option).toBeUndefined();
    expect(unknown.find((e) => e.tag === "input" && e.name === "summary").default_value).toBeUndefined();
    expect(withAi.find((e) => e.tag === "button").behaviors[0].value).toEqual({ action: "confirm_draft", draftId: "d1" });
  });
});

describe("AI triage", () => {
  const qwen: AiConfig = { provider: "QWEN", apiKey: "sk-test-qwen-1234" };
  const reply = (content: string, status = 200) =>
    (async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status })) as unknown as typeof fetch;
  const capture = () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const impl = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"充电桩离线","ticketType":"FAULT","faultType":"Offline"}' } }] }));
    }) as unknown as typeof fetch;
    return { seen, impl };
  };

  it("returns nothing without a configuration", async () => {
    const { seen, impl } = capture();
    expect(await triageMessages(null, "x", ["Offline"], impl)).toBeNull();
    expect(seen).toHaveLength(0);
  });

  it("calls the chosen provider's compatible endpoint with JSON output", async () => {
    const { seen, impl } = capture();
    await triageMessages(qwen, "charger offline", ["Offline"], impl);
    await triageMessages({ provider: "DEEPSEEK", apiKey: "sk-deep-5678" }, "x", [], impl);
    await triageMessages({ provider: "QWEN", apiKey: "k-12345678", model: "qwen-max" }, "x", [], impl);
    expect(seen.map((s) => s.url)).toEqual([
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      "https://api.deepseek.com/chat/completions",
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
    ]);
    expect((seen[0].init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test-qwen-1234");
    const bodies = seen.map((s) => JSON.parse(String(s.init.body)));
    expect(bodies.map((b) => b.model)).toEqual(["qwen-plus", "deepseek-flash", "qwen-max"]);
    expect(bodies[0].response_format).toEqual({ type: "json_object" });
    expect(bodies[0].messages[0].content).toContain("json");
    expect(bodies[0].messages[1].content).toContain("<customer_messages>\ncharger offline");
  });

  it("keeps the type and fault type only when valid", async () => {
    expect(await triageMessages(qwen, "x", ["Offline"], reply('{"summary":" 充电桩离线。 ","ticketType":"FAULT","faultType":"Offline"}'))).toEqual({
      summary: "充电桩离线。",
      ticketType: "FAULT",
      faultType: "Offline"
    });
    expect(await triageMessages(qwen, "x", ["Offline"], reply('{"summary":"s","ticketType":"WHAT","faultType":"none"}'))).toEqual({
      summary: "s",
      ticketType: null,
      faultType: null
    });
    // A product request never carries a fault type.
    expect(await triageMessages(qwen, "x", ["Offline"], reply('{"summary":"想要 App","ticketType":"PRODUCT_REQUEST","faultType":"Offline"}'))).toEqual({
      summary: "想要 App",
      ticketType: "PRODUCT_REQUEST",
      faultType: null
    });
  });

  it("degrades to no suggestion on an error status, empty or bad JSON, or a network failure", async () => {
    expect(await triageMessages(qwen, "x", [], reply("{}", 401))).toBeNull();
    expect(await triageMessages(qwen, "x", [], reply(""))).toBeNull();
    expect(await triageMessages(qwen, "x", [], reply("not json"))).toBeNull();
    expect(await triageMessages(qwen, "x", [], reply('{"faultType":"Offline"}'))).toBeNull();
    const failing = (async () => { throw new Error("down"); }) as unknown as typeof fetch;
    expect(await triageMessages(qwen, "x", [], failing)).toBeNull();
  });

  it("never echoes the key in a test error", async () => {
    const echo = (async () => new Response("bad key sk-test-qwen-1234, header Bearer sk-test-qwen-1234", { status: 401 })) as unknown as typeof fetch;
    const result = await testAiKey(qwen, echo);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("sk-test-qwen-1234");
    expect(redactKey("Authorization: Bearer abc.def", "zzz")).toBe("Authorization: Bearer ***");
  });
});

describe("personal AI key encryption", () => {
  it("round-trips, and fails for another user or another master secret", async () => {
    const sealed = await sealApiKey("master-1", "usr_a", "sk-secret-value");
    expect(sealed.cipher).not.toContain("secret");
    expect(await openApiKey("master-1", "usr_a", sealed)).toBe("sk-secret-value");
    await expect(openApiKey("master-1", "usr_b", sealed)).rejects.toThrow();
    await expect(openApiKey("master-2", "usr_a", sealed)).rejects.toThrow();
    const again = await sealApiKey("master-1", "usr_a", "sk-secret-value");
    expect(again.iv).not.toBe(sealed.iv);
    expect(maskApiKey("1234")).toBe("sk-****1234");
  });
});

describe("requirement pool", () => {
  it("reads the base and table from a Bitable link", () => {
    expect(parsePoolUrl("https://abc.feishu.cn/base/bascnXYZ123?table=tblAbC9&view=vew1")).toEqual({ appToken: "bascnXYZ123", tableId: "tblAbC9" });
    expect(parsePoolUrl("https://abc.feishu.cn/base/bascnXYZ123")).toBeNull();
    expect(parsePoolUrl("https://abc.feishu.cn/wiki/xyz?table=tbl1")).toBeNull();
    expect(parsePoolUrl("not a url")).toBeNull();
  });

  it("reports missing and non-text columns", () => {
    const items = POOL_FIELDS.filter((f) => f !== "SN").map((field_name) => ({ field_name, type: field_name === "提交日期" ? 5 : 1 }));
    expect(checkPoolFields(items)).toEqual({ missing: ["SN"], notText: ["提交日期"] });
  });

  it("maps a ticket to a row, using the customer's words from Feishu", () => {
    const row = poolRecordFields(
      {
        id: "tkt_1",
        ticketNo: "TK-1",
        createdAt: "2026-10-20 08:00:00",
        customerCompany: "ACME",
        productName: "AC 7kW",
        productModel: "AC7-EU",
        serialNumber: null,
        summary: null,
        firstNote: "From Feishu: 希望支持 OCPP 2.0.1",
        serviceName: "Dev Service"
      },
      "https://portal.example"
    );
    expect(row).toMatchObject({ 工单号: "TK-1", 提交日期: "2026-10-20", 型号: "AC7-EU", 摘要: "希望支持 OCPP 2.0.1", 客户原话: "希望支持 OCPP 2.0.1", SN: "" });
    expect(row.工单链接).toBe("https://portal.example/tickets/tkt_1");
    expect(poolRecordFields({ ...({} as any), id: "t", ticketNo: "T", createdAt: "", customerCompany: "", firstNote: "Ticket type: Product request" }, null).客户原话).toBe("");
  });
});
