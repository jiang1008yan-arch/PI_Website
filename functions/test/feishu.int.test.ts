import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setAiFetch } from "../lib/aiTriage";
import { setFeishuFetch } from "../lib/feishu/client";
import { drainFeishuOutbox } from "../lib/feishu/sync";
import { runScheduledJobs } from "../scheduled";
import { createHarness, seedProduct, type Harness } from "./harness";

// The Feishu bot end to end against a fake Feishu Open API: binding, @bot
// requests, confirming a ticket from the private card, updating it from the
// group card, and keeping the card / customer group / sales in step with
// changes made in the portal.

type Call = { method: string; path: string; body: any };

let h: Harness;
let calls: Call[];
let failing: boolean;
let nextId: number;
// Cards the fake Feishu refused as invalid; any is a bug.
let refused: string[];

const SERVICE_CHAT = "oc_service";
const CUSTOMER_CHAT = "oc_customer";

function fakeFeishu(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace("/open-apis", "") + url.search;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method: init?.method ?? "GET", path, body });
    const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
    if (path.startsWith("/auth/v3/tenant_access_token")) return json({ code: 0, tenant_access_token: "t-1", expire: 7200 });
    if (failing) return json({ code: 99991400, msg: "rate limited" });
    // Like Feishu: a card with an input allowing more than 1000 characters is refused whole.
    if (typeof body?.content === "string" && /"max_length":(\d+)/.test(body.content) && [...body.content.matchAll(/"max_length":(\d+)/g)].some((m) => Number(m[1]) > 1000)) {
      refused.push(path);
      return json({ code: 230099, msg: "Failed to create card content, ErrMsg: max_length exceed the default maximum 1000" });
    }
    if (path.startsWith("/bitable/") && init?.method === "POST") return json({ code: 0, data: { record: { record_id: `rec_${++nextId}` } } });
    if (path.startsWith("/bitable/")) return json({ code: 0, data: { items: [{ field_name: "工单号", type: 1 }, { field_name: "提交日期", type: 5 }] } });
    const method = init?.method ?? "GET";
    // Files of messages in the bot's private chat; none inside a merged forward.
    const resource = path.match(/^\/im\/v1\/messages\/([^/]+)\/resources\/([^?]+)\?type=(image|file)$/);
    if (resource && method === "GET") {
      if (resource[1].startsWith("om_sub")) return json({ code: 234043, msg: "Unsupported message type" });
      const files: Record<string, [string, string]> = {
        img_1: ["image/png", "PNG!"],
        file_voice: ["audio/ogg", "OggS-voice"],
        file_video: ["video/mp4", "mp4-bytes"],
        file_doc: ["application/octet-stream", "log line"]
      };
      const [type, data] = files[resource[2]] ?? ["application/octet-stream", "?"];
      return new Response(data, { headers: { "content-type": type, "content-length": String(data.length) } });
    }
    if (path.startsWith("/im/v1/messages/om_merge") && method === "GET") {
      const sub = (id: string, msg_type: string, content: unknown) => ({ message_id: id, msg_type, chat_id: CUSTOMER_CHAT, upper_message_id: "om_merge", body: { content: JSON.stringify(content) } });
      return json({
        code: 0,
        data: {
          items: [
            { message_id: "om_merge", msg_type: "merge_forward", chat_id: "oc_dm", body: { content: "Merged and Forwarded Message" } },
            sub("om_sub1", "text", { text: "Charger on PO-2026-0901 keeps going offline" }),
            sub("om_sub2", "image", { image_key: "img_1" }),
            sub("om_sub3", "text", { text: "从昨天开始的" })
          ]
        }
      });
    }
    if (path.startsWith("/im/v1/chats") && method === "GET") {
      return json({ code: 0, data: { items: [{ chat_id: SERVICE_CHAT, name: "After-sales" }, { chat_id: CUSTOMER_CHAT, name: "Iberia Charge 售后" }], has_more: false } });
    }
    return json({ code: 0, data: { message_id: `om_${++nextId}` } });
  }) as typeof fetch;
}

const push = (path: string, payload: unknown) => h.raw("POST", path, JSON.stringify(payload));
const cardAction = (
  openId: string,
  value: Record<string, string>,
  form: Record<string, string> = {},
  eventId = `ev_${Math.random()}`,
  messageId = "om_card",
  unionId?: string
) =>
  push("/feishu/card", {
    schema: "2.0",
    header: { event_id: eventId, token: "vt", event_type: "card.action.trigger" },
    event: { operator: { open_id: openId, ...(unionId ? { union_id: unionId } : {}) }, action: { value, form_value: form, tag: "button" }, context: { open_message_id: messageId, open_chat_id: SERVICE_CHAT } }
  });
const messages = (filter: (c: Call) => boolean) => calls.filter((c) => c.path.startsWith("/im/v1/messages") && filter(c));

beforeEach(async () => {
  h = await createHarness({
    FEISHU_APP_ID: "cli_test",
    FEISHU_APP_SECRET: "secret",
    FEISHU_VERIFICATION_TOKEN: "vt",
    FEISHU_SERVICE_CHAT_ID: SERVICE_CHAT,
    APP_BASE_URL: "https://portal.example",
    AI_KEY_SECRET: "test-ai-master"
  });
  calls = [];
  refused = [];
  failing = false;
  nextId = 0;
  setFeishuFetch(fakeFeishu());
  await h.request("ADMIN", "PUT", "/options/faultType", { values: ["Offline / no network", "Screen fault"] });
  await h.db.prepare("UPDATE users SET feishuOpenId = 'ou_sales' WHERE id = ?").bind(h.users.SALES.id).run();
});
afterEach(async () => {
  expect(refused).toEqual([]);
  setFeishuFetch(null);
  setAiFetch(null);
  await h.close();
});

describe("Feishu push endpoints", () => {
  it("answers the URL verification handshake and rejects a wrong token", async () => {
    expect((await push("/feishu/events", { type: "url_verification", token: "vt", challenge: "abc" })).body).toEqual({ challenge: "abc" });
    expect((await push("/feishu/events", { type: "url_verification", token: "nope", challenge: "abc" })).status).toBe(401);
    expect((await push("/feishu/card", { schema: "2.0", header: { token: "nope" }, event: {} })).status).toBe(401);
  });
});

describe("one Feishu identity", () => {
  it("an unlinked person gets the Sign in with Feishu link (never a silent bind)", async () => {
    const res = await cardAction("ou_new", { action: "take", ticketId: "x" }, {}, undefined, undefined, "on_new");
    expect(res.body.toast.type).toBe("warning");
    await h.settle();
    const dm = messages((c) => c.path.includes("receive_id_type=union_id"));
    expect(dm).toHaveLength(1);
    expect(dm[0].body.receive_id).toBe("on_new");
    expect(dm[0].body.content).toContain("https://portal.example/api/auth/feishu/start?next=");
    expect((await h.request("SERVICE", "POST", "/feishu/bind", { token: "x" })).status).toBe(404);
  });

  it("people linked by union id (e.g. through the PI Assistant) are known to this bot too", async () => {
    await h.db.prepare("UPDATE users SET feishuUnionId = 'on_service' WHERE id = ?").bind(h.users.SERVICE.id).run();
    const id = (await h.request("SERVICE", "POST", "/tickets", { contactName: "Li", contactInfo: "x", productId: await seedProduct(h.db), answers: {} })).body.id;
    await h.settle();
    // The owner's card goes out by union id, and a click from this app's own open id works.
    expect(messages((c) => c.body?.msg_type === "interactive")[0].path).toContain("receive_id_type=union_id");
    const res = await cardAction("ou_other_app_id", { action: "update", ticketId: id }, { note: "On site tomorrow" }, undefined, undefined, "on_service");
    expect(res.body.toast.type).toBe("success");
    await h.settle();
  });

  it("an old open-id link is upgraded to the union id on first contact", async () => {
    await h.db.prepare("UPDATE users SET feishuOpenId = 'ou_service' WHERE id = ?").bind(h.users.SERVICE.id).run();
    await cardAction("ou_service", { action: "dismiss_draft", draftId: "x" }, {}, undefined, undefined, "on_service");
    const row = await h.db.prepare("SELECT feishuUnionId FROM users WHERE id = ?").bind(h.users.SERVICE.id).first<{ feishuUnionId: string }>();
    expect(row?.feishuUnionId).toBe("on_service");
  });

  it("a ticket whose after-sales owner is not linked is reported to the linked admins", async () => {
    await h.db.prepare("UPDATE users SET feishuUnionId = 'on_admin' WHERE id = ?").bind(h.users.ADMIN.id).run();
    await h.request("SERVICE", "POST", "/tickets", { customerCompany: "ACME", contactName: "Li", contactInfo: "x", productId: await seedProduct(h.db), answers: {} });
    await h.settle();
    const toAdmin = messages((c) => c.body?.receive_id === "on_admin").map((c) => JSON.parse(c.body.content).text);
    expect(toAdmin).toHaveLength(1);
    expect(toAdmin[0]).toContain("has not linked Feishu");
  });
});

describe("collecting a ticket request in the private chat", () => {
  let aiModels: string[];
  const event = (messageId: string, msgType: string, content: unknown, opts: { openId?: string; chatType?: string; chatId?: string; time?: number } = {}) =>
    push("/feishu/events", {
      schema: "2.0",
      header: { event_id: `e-${messageId}`, token: "vt", event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: opts.openId ?? "ou_service" }, sender_type: "user" },
        message: {
          message_id: messageId,
          chat_id: opts.chatId ?? "oc_dm",
          chat_type: opts.chatType ?? "p2p",
          message_type: msgType,
          create_time: String(opts.time ?? Date.now()),
          content: JSON.stringify(content)
        }
      }
    });
  const text = (messageId: string, value: string, opts: Parameters<typeof event>[3] = {}) => event(messageId, "text", { text: value }, opts);
  const openDraft = async () => (await h.db.prepare("SELECT * FROM feishuDrafts WHERE ticketId IS NULL AND dismissedAt IS NULL AND expiredAt IS NULL").first<any>())!;
  const items = async (draftId: string) => (await h.db.prepare("SELECT * FROM feishuDraftItems WHERE draftId = ? ORDER BY position").bind(draftId).all<any>()).results;
  const cardsTo = (openId: string) => messages((c) => c.body?.receive_id === openId && c.body.msg_type === "interactive");
  const textsTo = (openId: string) => messages((c) => c.body?.receive_id === openId && c.body.msg_type === "text").map((c) => JSON.parse(c.body.content).text as string);
  const patched = (messageId: string) => JSON.parse(messages((c) => c.method === "PATCH" && c.path === `/im/v1/messages/${messageId}`).at(-1)!.body.content);
  const formOf = (card: any) => card.body.elements.find((e: any) => e.tag === "form").elements;

  beforeEach(async () => {
    await h.db.prepare("UPDATE users SET feishuOpenId = 'ou_service' WHERE id = ?").bind(h.users.SERVICE.id).run();
    aiModels = [];
    setAiFetch((async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      aiModels.push(body.model);
      const content =
        body.model === "qwen3-asr-flash"
          ? "屏幕一直显示 E12"
          : JSON.stringify({
              summary: "Screen shows E12 and the charger stops charging",
              digest: "- Customer reports the charger stops charging\n- Picture: screen shows E12",
              ticketType: "FAULT",
              faultType: "Screen fault"
            });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
    }) as unknown as typeof fetch);
  });

  it("a direct message opens one collecting card; Discard closes it and the next message starts a new request", async () => {
    await text("om_t1", "客户说充电桩坏了");
    await h.settle();
    const card = cardsTo("ou_service");
    expect(card).toHaveLength(1);
    const json = JSON.stringify(JSON.parse(card[0].body.content));
    expect(json).toContain('"action":"open_draft"');
    expect(json).toContain('"action":"dismiss_draft"');
    expect(json).toContain('"action":"remove_item"');
    expect(json).toContain("1 text");
    expect(json).not.toContain("confirm_draft"); // no form yet, and no AI has run
    const first = await openDraft();

    await text("om_t2", "SN 在照片里");
    await h.settle();
    expect(cardsTo("ou_service")).toHaveLength(1); // the same card, redrawn
    expect(JSON.stringify(patched(first.cardMessageId))).toContain("2 texts");

    expect((await cardAction("ou_service", { action: "dismiss_draft", draftId: first.id }, {}, "e-dismiss", first.cardMessageId)).body.toast.type).toBe("info");
    await h.settle();
    expect(patched(first.cardMessageId).header.title.content).toBe("Discarded");
    await text("om_t3", "another customer");
    await h.settle();
    expect((await openDraft()).id).not.toBe(first.id);
    expect(cardsTo("ou_service")).toHaveLength(2);
  });

  it("messages forwarded one by one at the same time land in one request, in order, with their files saved", async () => {
    const t = Date.now();
    await Promise.all([
      event("om_img", "image", { image_key: "img_1" }, { time: t + 1 }),
      text("om_txt", "充电桩屏幕报错", { time: t }),
      event("om_voice", "audio", { file_key: "file_voice", duration: 12000 }, { time: t + 2 }),
      event("om_video", "media", { file_key: "file_video", image_key: "thumb", file_name: "site.mp4", duration: 30000 }, { time: t + 3 })
    ]);
    await h.settle();
    expect((await h.db.prepare("SELECT COUNT(*) AS n FROM feishuDrafts").first<any>()).n).toBe(1);
    const draft = await openDraft();
    const list = await items(draft.id);
    expect(list.map((i: any) => i.kind)).toEqual(["TEXT", "IMAGE", "AUDIO", "VIDEO"]);
    expect(list[1]).toMatchObject({ contentType: "image/png", size: 4, problem: null });
    expect(list[3]).toMatchObject({ fileName: "site.mp4", durationMs: 30000 });
    expect(await (await h.env.FILES.get(list[1].r2Key))!.text()).toBe("PNG!");
    expect(cardsTo("ou_service")).toHaveLength(1);
    expect(draft.text).toBe("充电桩屏幕报错\n[Picture]\n[Voice message 0:12]\n[Video 0:30]");
  });

  it("a merged forward is expanded: its texts are kept, its files listed as not saved, and its group offered for notices", async () => {
    await event("om_merge", "merge_forward", "Merged and Forwarded Message");
    await h.settle();
    const draft = await openDraft();
    const list = await items(draft.id);
    expect(list.map((i: any) => [i.kind, i.text, i.problem])).toEqual([
      ["TEXT", "Charger on PO-2026-0901 keeps going offline", null],
      ["IMAGE", null, "IN_FORWARD"],
      ["TEXT", "从昨天开始的", null]
    ]);
    expect(draft.suggestedChatId).toBe(CUSTOMER_CHAT);
    expect(cardsTo("ou_service")[0].body.content).toContain("forward this one on its own");

    await cardAction("ou_service", { action: "open_draft", draftId: draft.id }, {}, "e-open-merge", draft.cardMessageId);
    await h.settle();
    const notify = formOf(patched(draft.cardMessageId)).find((e: any) => e.name === "notifyChat");
    expect(notify.initial_option).toBe(CUSTOMER_CHAT);
    expect(notify.options.map((o: any) => o.value)).toEqual(["none", CUSTOMER_CHAT]); // never the internal group
  });

  it("only after-sales and admins collect requests; an @ in a group only reminds them privately", async () => {
    await text("om_g1", "@_user_1 please log this", { chatType: "group", chatId: CUSTOMER_CHAT });
    await text("om_g2", "@_user_1 help", { chatType: "group", chatId: CUSTOMER_CHAT, openId: "ou_customer" });
    await text("om_s1", "客户的桩坏了", { openId: "ou_sales" });
    await text("om_u1", "hello", { openId: "ou_stranger" });
    await h.settle();
    expect((await h.db.prepare("SELECT COUNT(*) AS n FROM feishuDrafts").first<any>()).n).toBe(0);
    expect(textsTo("ou_service")[0]).toContain("forward the customer's messages to me here in our private chat");
    expect(messages((c) => c.body?.receive_id === CUSTOMER_CHAT || c.body?.receive_id === "ou_customer")).toHaveLength(0);
    expect(textsTo("ou_sales")[0]).toContain("Only after-sales and admins");
    expect(cardsTo("ou_stranger")[0].body.content).toContain("/api/auth/feishu/start");
  });

  it("Prepare ticket reads voice and pictures with Qwen; Re-recognize keeps hand edits; the ticket gets the files and tells the chosen group", async () => {
    await h.request("SERVICE", "PUT", "/me/ai", { provider: "QWEN", apiKey: "sk-service-key-1" });
    const t = Date.now();
    await text("om_a", "客户反馈", { time: t });
    await event("om_b", "image", { image_key: "img_1" }, { time: t + 1 });
    await event("om_c", "audio", { file_key: "file_voice", duration: 5000 }, { time: t + 2 });
    await h.settle();
    const draft = await openDraft();
    aiModels = [];
    await cardAction("ou_service", { action: "open_draft", draftId: draft.id }, {}, "e-prep", draft.cardMessageId);
    await h.settle();
    expect(aiModels.sort()).toEqual(["qwen3-asr-flash", "qwen3-vl-plus"]);
    let form = patched(draft.cardMessageId);
    expect(JSON.stringify(form)).toContain("Screen shows E12");
    expect(JSON.stringify(form)).toContain("屏幕一直显示 E12"); // the transcript is listed
    expect(formOf(form).find((e: any) => e.name === "faultType").initial_option).toBe("Screen fault");
    expect(formOf(form).find((e: any) => e.name === "details").default_value).toBe("- Customer reports the charger stops charging\n- Picture: screen shows E12");

    // New material while the form is open: a note, not a redraw.
    calls = [];
    await text("om_d", "SN 是 CHG-0901-0001");
    await h.settle();
    expect(messages((c) => c.method === "PATCH")).toHaveLength(0);
    expect(textsTo("ou_service")[0]).toContain("Press Re-recognize");

    // Remove the picture (a form button: what was typed is kept) — the form says the material changed.
    const picture = (await items(draft.id)).find((i: any) => i.kind === "IMAGE");
    await cardAction("ou_service", { action: "remove_item", draftId: draft.id, itemId: picture.id }, { contactName: "Ana", summary: "Display error E12" }, "e-rm", draft.cardMessageId);
    await h.settle();
    form = patched(draft.cardMessageId);
    expect(JSON.stringify(form)).toContain("1 added, 1 removed");
    expect(formOf(form).find((e: any) => e.name === "contactName").default_value).toBe("Ana");
    expect(await h.env.FILES.get(picture.r2Key)).toBeNull();

    // Re-recognize: the hand-written summary stays; the voice is not transcribed again.
    aiModels = [];
    await cardAction("ou_service", { action: "rerun_draft", draftId: draft.id }, { contactName: "Ana", summary: "Display error E12", details: "- E12 since Monday", faultType: "Screen fault" }, "e-rerun", draft.cardMessageId);
    await h.settle();
    expect(aiModels).toEqual(["qwen-plus"]);
    form = patched(draft.cardMessageId);
    expect(formOf(form).find((e: any) => e.name === "summary").default_value).toBe("Display error E12");
    expect(formOf(form).find((e: any) => e.name === "details").default_value).toBe("- E12 since Monday");
    expect(JSON.stringify(form)).not.toContain("removed");

    calls = [];
    const created = await cardAction(
      "ou_service",
      { action: "confirm_draft", draftId: draft.id },
      { contactName: "Ana", summary: "Display error E12", details: "- E12 since Monday", ticketType: "FAULT", faultType: "Screen fault", notifyChat: CUSTOMER_CHAT },
      "e-create",
      draft.cardMessageId
    );
    expect(created.body.toast.type).toBe("success");
    await h.settle();
    const ticket = await h.db.prepare("SELECT * FROM tickets").first<any>();
    expect(ticket).toMatchObject({ summary: "Display error E12", faultType: "Screen fault", feishuSourceChatId: CUSTOMER_CHAT, feishuSourceMessageId: null });
    const detail = (await h.request("SERVICE", "GET", `/tickets/${ticket.id}`)).body;
    expect(detail.attachments.map((a: any) => a.fileName)).toEqual(["voice-1.ogg"]);
    expect(detail.updates[0].note).toMatch(/^- E12 since Monday\n\nFrom Feishu:\n/);
    expect(detail.updates[0].note).toContain("[Voice message 0:05] 屏幕一直显示 E12");
    const receipt = messages((c) => c.body?.receive_id === CUSTOMER_CHAT).map((c) => JSON.parse(c.body.content).text);
    expect(receipt[0]).toContain(ticket.ticketNo);
    // The creator owns the ticket: the request card stands for it, no second card asks for a status.
    expect(cardsTo("ou_service")).toHaveLength(0);
    expect(ticket.feishuCardMessageId).toBe(draft.cardMessageId);
    const done = JSON.stringify(patched(draft.cardMessageId));
    expect(done).toContain(`Ticket ${ticket.ticketNo} created`);
    expect(done).not.toContain("update_form");
    await cardAction("ou_service", { action: "show_ticket", ticketId: ticket.id }, {}, "e-show", draft.cardMessageId);
    await h.settle();
    const working = patched(draft.cardMessageId);
    expect(working.header.title.content).toBe(`${ticket.ticketNo} · New`);
    expect(JSON.stringify(working)).toContain('"action":"update"');
    // The attached file outlives the request's cleanup.
    await runScheduledJobs(h.env, new Date());
    const voiceKey = (await h.db.prepare("SELECT r2Key FROM ticketAttachments").first<any>()).r2Key;
    expect(await h.env.FILES.get(voiceKey)).not.toBeNull();
    // A second press does not create another ticket.
    expect((await cardAction("ou_service", { action: "confirm_draft", draftId: draft.id }, { contactName: "Ana" }, "e-create-2", draft.cardMessageId)).body.toast.type).toBe("info");
  });

  it("pictures the AI cannot read fall back to the text; when the AI gives nothing the form says so", async () => {
    await h.request("SERVICE", "PUT", "/me/ai", { provider: "QWEN", apiKey: "sk-service-key-1" });
    let textFails = false;
    setAiFetch((async (_url: string, init: RequestInit) => {
      const model = JSON.parse(String(init.body)).model;
      aiModels.push(model);
      if (model === "qwen3-vl-plus" || textFails) return new Response(JSON.stringify({ error: { message: "Model not exist." } }), { status: 404 });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "Charger offline, E12 on screen", ticketType: "FAULT", faultType: "none" }) } }] }));
    }) as unknown as typeof fetch);
    await text("om_f1", "一直离线，屏幕显示 E12");
    await event("om_f2", "image", { image_key: "img_1" });
    await h.settle();
    const draft = await openDraft();
    aiModels = [];
    await cardAction("ou_service", { action: "open_draft", draftId: draft.id }, {}, "e-f-prep", draft.cardMessageId);
    await h.settle();
    expect(aiModels).toEqual(["qwen3-vl-plus", "qwen-plus"]);
    expect(formOf(patched(draft.cardMessageId)).find((e: any) => e.name === "summary").default_value).toBe("Charger offline, E12 on screen");

    textFails = true;
    await cardAction("ou_service", { action: "rerun_draft", draftId: draft.id }, { contactName: "Ana" }, "e-f-rerun", draft.cardMessageId);
    await h.settle();
    expect(JSON.stringify(patched(draft.cardMessageId))).toContain("The AI could not make a suggestion this time");
  });

  it("without a Qwen key the form says what the AI did not read, and no customer group is told by default", async () => {
    await h.request("SERVICE", "PUT", "/me/ai", { provider: "DEEPSEEK", apiKey: "sk-deep-5678" });
    await text("om_x", "黑屏");
    await event("om_y", "image", { image_key: "img_1" });
    await event("om_z", "media", { file_key: "file_video", file_name: "a.mp4" });
    await h.settle();
    const draft = await openDraft();
    aiModels = [];
    await cardAction("ou_service", { action: "open_draft", draftId: draft.id }, {}, "e-open-ds", draft.cardMessageId);
    await h.settle();
    expect(aiModels).toEqual(["deepseek-flash"]);
    const form = JSON.stringify(patched(draft.cardMessageId));
    expect(form).toContain("Pictures were not read by the AI");
    expect(form).toContain("Videos are not read by the AI");
    await cardAction("ou_service", { action: "confirm_draft", draftId: draft.id }, { contactName: "Li", notifyChat: "none" }, "e-c-ds", draft.cardMessageId);
    await h.settle();
    expect((await h.db.prepare("SELECT feishuSourceChatId FROM tickets").first<any>()).feishuSourceChatId).toBeNull();
    expect(messages((c) => c.body?.receive_id === CUSTOMER_CHAT)).toHaveLength(0);
  });

  it("someone else's request cannot be touched, and discarded requests lose their files", async () => {
    await h.db.prepare("UPDATE users SET feishuOpenId = 'ou_admin' WHERE id = ?").bind(h.users.ADMIN.id).run();
    await event("om_f", "file", { file_key: "file_doc", file_name: "log.txt" });
    await h.settle();
    const draft = await openDraft();
    const [file] = await items(draft.id);
    expect(file).toMatchObject({ kind: "FILE", fileName: "log.txt" });
    expect((await cardAction("ou_admin", { action: "open_draft", draftId: draft.id }, {}, "e-other", draft.cardMessageId)).body.toast.content).toContain("someone else");
    await cardAction("ou_service", { action: "dismiss_draft", draftId: draft.id }, {}, "e-d", draft.cardMessageId);
    await runScheduledJobs(h.env, new Date());
    expect(await h.env.FILES.get(file.r2Key)).toBeNull();
    expect(await items(draft.id)).toEqual([]);
  });

  it("Add pictures / files on a ticket card collects what is sent next and saves it as one progress update", async () => {
    // A ticket created from a request, whose card offers New → Resolved and Add pictures / files.
    await text("om_n1", "充电枪拔不出来");
    await h.settle();
    const request = await openDraft();
    await cardAction("ou_service", { action: "confirm_draft", draftId: request.id }, { contactName: "Ana" }, "e-n-create", request.cardMessageId);
    await h.settle();
    const ticket = await h.db.prepare("SELECT * FROM tickets").first<any>();
    await cardAction("ou_service", { action: "show_ticket", ticketId: ticket.id }, {}, "e-n-show", request.cardMessageId);
    await h.settle();
    const card = patched(request.cardMessageId);
    expect(formOf(card).find((e: any) => e.name === "status").options.map((o: any) => o.value)).toEqual(["IN_PROGRESS", "RESOLVED"]);
    expect(JSON.stringify(card)).toContain('"action":"add_to_ticket"');

    calls = [];
    expect((await cardAction("ou_service", { action: "add_to_ticket", ticketId: ticket.id }, {}, "e-add", request.cardMessageId)).body.toast.content).toContain(ticket.ticketNo);
    await h.settle();
    const addCardMessage = cardsTo("ou_service");
    expect(addCardMessage).toHaveLength(1);
    expect(JSON.parse(addCardMessage[0].body.content).header.title.content).toBe(`Add to ${ticket.ticketNo}`);
    // A second press says so; nothing new is started.
    expect((await cardAction("ou_service", { action: "add_to_ticket", ticketId: ticket.id }, {}, "e-add-2", request.cardMessageId)).body.toast.content).toContain("Already adding");

    await text("om_n2", "已更换充电枪，客户确认可以正常使用");
    await event("om_n3", "image", { image_key: "img_1" });
    await h.settle();
    const addition = await openDraft();
    expect(addition.targetTicketId).toBe(ticket.id);
    expect(JSON.stringify(patched(addition.cardMessageId))).toContain("1 text · 1 picture");
    // Only Save, Cancel and Remove work on it.
    expect((await cardAction("ou_service", { action: "open_draft", draftId: addition.id }, {}, "e-add-open", addition.cardMessageId)).body.toast.content).toContain("Save to ticket");

    const saved = await cardAction("ou_service", { action: "save_addition", draftId: addition.id }, {}, "e-add-save", addition.cardMessageId);
    expect(saved.body.toast.type).toBe("success");
    await h.settle();
    const detail = (await h.request("SERVICE", "GET", `/tickets/${ticket.id}`)).body;
    const update = detail.updates.find((u: any) => u.note?.startsWith("已更换充电枪"));
    expect(update.note).toBe("已更换充电枪，客户确认可以正常使用\n[Picture]");
    expect(detail.attachments.filter((a: any) => a.updateId === update.id).map((a: any) => a.fileName)).toEqual(["picture-1.png"]);
    expect(patched(addition.cardMessageId).header.title.content).toBe(`Added to ${ticket.ticketNo}`);
    // The saved files stay; the next message starts a new request.
    await runScheduledJobs(h.env, new Date());
    expect(await h.env.FILES.get((await items(addition.id))[1].r2Key)).not.toBeNull();
    await text("om_n4", "另一个客户");
    await h.settle();
    expect((await openDraft()).targetTicketId).toBeNull();
  });

  it("Add pictures / files waits for an open request, and Cancel adds nothing", async () => {
    await h.db
      .prepare(
        `INSERT INTO tickets (id, ticketNo, seq, status, customerCompany, orderNo, contactName, contactInfo, productId, answers, assignedServiceId)
         VALUES ('t1', 'TK-1', 1, 'IN_PROGRESS', 'Co', '', 'x', 'x', NULL, '{}', ?)`
      )
      .bind(h.users.SERVICE.id)
      .run();
    await text("om_p1", "新的问题");
    await h.settle();
    expect((await cardAction("ou_service", { action: "add_to_ticket", ticketId: "t1" }, {}, "e-p-add")).body.toast.content).toContain("open ticket request");
    await cardAction("ou_service", { action: "dismiss_draft", draftId: (await openDraft()).id }, {}, "e-p-d", (await openDraft()).cardMessageId);

    await cardAction("ou_service", { action: "add_to_ticket", ticketId: "t1" }, {}, "e-p-add-2");
    await h.settle();
    await event("om_p2", "image", { image_key: "img_1" });
    await h.settle();
    const addition = await openDraft();
    const [picture] = await items(addition.id);
    await cardAction("ou_service", { action: "dismiss_draft", draftId: addition.id }, {}, "e-p-cancel", addition.cardMessageId);
    await h.settle();
    expect(patched(addition.cardMessageId).header.title.content).toBe("Cancelled");
    await runScheduledJobs(h.env, new Date());
    expect(await h.env.FILES.get(picture.r2Key)).toBeNull();
    expect((await h.db.prepare("SELECT COUNT(*) AS n FROM ticketUpdates WHERE ticketId = 't1'").first<any>()).n).toBe(0);
  });
});

describe("earlier tickets like this one", () => {
  const seedTicket = (id: string, fields: Record<string, unknown>) =>
    h.db
      .prepare(
        `INSERT INTO tickets (id, ticketNo, seq, status, customerCompany, orderNo, contactName, contactInfo, productId, answers, serialNumber, faultType, summary, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, 'x', 'x', ?, '{}', ?, ?, ?, ?)`
      )
      .bind(
        id,
        `T-${id}`,
        Number(id.replace(/\D/g, "")) || 1,
        fields.status ?? "RESOLVED",
        fields.customerCompany ?? "",
        fields.orderNo ?? "",
        fields.productId ?? null,
        fields.serialNumber ?? null,
        fields.faultType ?? null,
        fields.summary ?? null,
        fields.createdAt ?? new Date().toISOString().slice(0, 19).replace("T", " ")
      )
      .run();

  beforeEach(async () => {
    await h.db.prepare("UPDATE users SET feishuOpenId = 'ou_service' WHERE id = ?").bind(h.users.SERVICE.id).run();
    await h.db
      .prepare(
        `INSERT INTO pi (id, piNo, seq, date, language, status, customerCompany, productionOrderNo, createdById, approvedAt)
         VALUES ('pi_a', 'ZH-001', 1, '2026-10-01', 'ZH', 'APPROVED', 'Iberia Charge SL', 'PO-2026-0901', ?, CURRENT_TIMESTAMP)`
      )
      .bind(h.users.SALES.id)
      .run();
    await h.db.prepare("INSERT INTO devices (id, serialNumber, piId, createdById) VALUES ('d1', 'CHG-0901-0001', 'pi_a', ?)").bind(h.users.SERVICE.id).run();
    await seedTicket("t1", { serialNumber: "CHG-0901-0001", status: "IN_PROGRESS", customerCompany: "Iberia Charge SL", orderNo: "PO-2026-0901", summary: "Offline since Monday" });
    await seedTicket("t2", { orderNo: "po-2026-0901", customerCompany: "Iberia Charge SL" });
    await seedTicket("t3", { customerCompany: "IBERIA CHARGE, S.L." });
    await seedTicket("t4", { customerCompany: "Iberia Charge", createdAt: "2020-01-01 00:00:00" }); // old and resolved: not shown
    await seedTicket("t5", { faultType: "Screen fault", customerCompany: "Other Co" });
    await seedTicket("t6", { faultType: "Screen fault", customerCompany: "Old Co", createdAt: "2020-01-01 00:00:00" });
  });

  it("lists the same device, order, customer and fault, each ticket once, warning about an open one on the device", async () => {
    const res = await h.request(
      "SERVICE",
      "GET",
      `/tickets/similar?serialNumber=chg-0901-0001&orderNo=PO-2026-0901&customerCompany=${encodeURIComponent("iberia charge sl")}&faultType=${encodeURIComponent("Screen fault")}`
    );
    expect(res.status).toBe(200);
    expect(res.body.layers.map((l: any) => [l.key, l.tickets.map((t: any) => t.id), l.openDuplicate])).toEqual([
      ["SN", ["t1"], true],
      ["ORDER", ["t2"], false],
      ["CUSTOMER", ["t3"], false],
      ["FAULT", ["t5"], false]
    ]);
    expect(res.body.layers[0].tickets[0].summary).toBe("Offline since Monday");
    expect((await h.request("SALES", "GET", "/tickets/similar?orderNo=PO-2026-0901")).status).toBe(403);
  });

  it("shows them on the Feishu form before the ticket is created", async () => {
    await push("/feishu/events", {
      schema: "2.0",
      header: { event_id: "e-sim", token: "vt", event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: "ou_service" }, sender_type: "user" },
        message: { message_id: "om_sim", chat_id: "oc_dm", chat_type: "p2p", message_type: "text", content: JSON.stringify({ text: "CHG-0901-0001 黑屏" }) }
      }
    });
    await h.settle();
    const draft = (await h.db.prepare("SELECT * FROM feishuDrafts").first<any>())!;
    await cardAction("ou_service", { action: "open_draft", draftId: draft.id }, {}, "e-sim-open", draft.cardMessageId);
    await h.settle();
    const form = JSON.stringify(JSON.parse(messages((c) => c.method === "PATCH" && c.path === `/im/v1/messages/${draft.cardMessageId}`).at(-1)!.body.content));
    expect(form).toContain("Earlier tickets like this");
    expect(form).toContain("Same device (SN CHG-0901-0001)");
    expect(form).toContain("already has an open ticket");
    expect(form).toContain("[T-t1](https://portal.example/tickets/t1)");
    expect(form).toContain("Same customer (Iberia Charge SL)");
  });

  it("the portal's New ticket can tell a customer group the bot is in, and no other", async () => {
    const productId = await seedProduct(h.db);
    const base = { contactName: "Li", contactInfo: "x", productId, answers: {} };
    expect((await h.request("SERVICE", "GET", "/feishu/chats")).body).toEqual([{ chatId: CUSTOMER_CHAT, name: "Iberia Charge 售后" }]);
    expect((await h.request("SERVICE", "POST", "/tickets", { ...base, feishuSourceChatId: "oc_unknown" })).status).toBe(400);
    expect((await h.request("SERVICE", "POST", "/tickets", { ...base, feishuSourceChatId: SERVICE_CHAT })).status).toBe(400);
    const ok = await h.request("SERVICE", "POST", "/tickets", { ...base, feishuSourceChatId: CUSTOMER_CHAT });
    expect(ok.status).toBe(200);
    await h.settle();
    expect(messages((c) => c.body?.receive_id === CUSTOMER_CHAT).map((c) => JSON.parse(c.body.content).text)[0]).toContain(ok.body.ticketNo);
  });
});

describe("working a ticket from the owner's card", () => {
  let ticketId: string;
  beforeEach(async () => {
    await h.db.prepare("UPDATE users SET feishuOpenId = 'ou_service' WHERE id = ?").bind(h.users.SERVICE.id).run();
    const productId = await seedProduct(h.db);
    const res = await h.request("SERVICE", "POST", "/tickets", { customerCompany: "ACME", orderNo: "PO-1", contactName: "Li", contactInfo: "x", productId, answers: {}, assignedSalesId: h.users.SALES.id });
    ticketId = res.body.id;
    // Start with no after-sales owner (sales cannot create tickets, so the creator would otherwise own it).
    await h.db.prepare("UPDATE tickets SET feishuSourceChatId = ?, assignedServiceId = NULL WHERE id = ?").bind(CUSTOMER_CHAT, ticketId).run();
    await h.settle();
    calls = [];
  });

  it("take, update with a note, resolve: the owner's card refreshes, sales is told privately, the customer hears only about resolution", async () => {
    expect((await cardAction("ou_sales", { action: "take", ticketId })).body.toast.type).toBe("warning"); // sales cannot take
    expect((await cardAction("ou_service", { action: "take", ticketId })).body.toast.type).toBe("success");
    await h.settle();
    const afterTake = await h.db.prepare("SELECT status, assignedServiceId, feishuCardMessageId FROM tickets WHERE id = ?").bind(ticketId).first<any>();
    expect(afterTake).toMatchObject({ status: "IN_PROGRESS", assignedServiceId: h.users.SERVICE.id });

    await cardAction("ou_service", { action: "update", ticketId }, { note: "Replaced the network module" });
    // A ticket cannot be resolved before it is classified.
    const unclassified = await cardAction("ou_service", { action: "update", ticketId }, { status: "RESOLVED" });
    expect(unclassified.body.toast).toMatchObject({ type: "error", content: "Choose the ticket type before resolving it." });
    expect((await h.request("SERVICE", "PATCH", `/tickets/${ticketId}/type`, { ticketType: "OTHER" })).status).toBe(200);
    await cardAction("ou_service", { action: "update", ticketId }, { status: "RESOLVED" });
    await h.settle();

    // Taking it sent the card to the new owner; later changes refresh that card.
    const card = afterTake.feishuCardMessageId;
    expect(messages((c) => c.body?.receive_id === "ou_service" && c.body.msg_type === "interactive")).toHaveLength(1);
    expect(messages((c) => c.method === "PATCH" && c.path === `/im/v1/messages/${card}`).length).toBeGreaterThanOrEqual(3);
    expect(messages((c) => c.body?.receive_id === SERVICE_CHAT)).toHaveLength(0);
    const toSales = messages((c) => c.body?.receive_id === "ou_sales").map((c) => JSON.parse(c.body.content).text);
    expect(toSales.length).toBeGreaterThanOrEqual(3);
    expect(toSales.some((t) => t.includes("Replaced the network module"))).toBe(true);
    const toCustomer = messages((c) => c.body?.receive_id === CUSTOMER_CHAT).map((c) => JSON.parse(c.body.content).text);
    expect(toCustomer).toHaveLength(1);
    expect(toCustomer[0]).toContain("resolved");

    // An invalid transition is refused with a toast, not an error page.
    expect((await cardAction("ou_service", { action: "update", ticketId }, { status: "NEW" })).body.toast.type).toBe("error");
  });

  it("portal changes refresh the card too, and failed pushes are retried", async () => {
    failing = true;
    await h.request("SERVICE", "PATCH", `/tickets/${ticketId}/status`, { status: "IN_PROGRESS" });
    await h.settle();
    let rows = await h.db.prepare("SELECT status, attempts, lastError FROM integrationOutbox WHERE status = 'FAILED'").all<any>();
    expect(rows.results.length).toBeGreaterThan(0);
    expect(rows.results[0].lastError).toContain("rate limited");

    failing = false;
    await drainFeishuOutbox(h.env);
    rows = await h.db.prepare("SELECT status FROM integrationOutbox WHERE status <> 'SENT'").all<any>();
    expect(rows.results).toEqual([]);
  });

  it("does nothing when the bot is not configured", async () => {
    h.env.FEISHU_APP_ID = undefined;
    await h.request("SERVICE", "PATCH", `/tickets/${ticketId}/status`, { status: "IN_PROGRESS" });
    await h.settle();
    expect(calls).toEqual([]);
  });
});

describe("AI keys, types, the requirement pool and owners", () => {
  const POOL = "https://acme.feishu.cn/base/bascnPool1?table=tblReq1&view=vew1";
  let aiCalls: string[];
  const dm = (openId: string, text: string, messageId: string) =>
    push("/feishu/events", {
      schema: "2.0",
      header: { event_id: `e-${messageId}`, token: "vt", event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: openId }, sender_type: "user" },
        message: { message_id: messageId, chat_id: "oc_dm", chat_type: "p2p", message_type: "text", content: JSON.stringify({ text }) }
      }
    });
  const lastDraftId = async () => (await h.db.prepare("SELECT id FROM feishuDrafts ORDER BY rowid DESC LIMIT 1").first<{ id: string }>())!.id;

  beforeEach(async () => {
    await h.db.prepare("UPDATE users SET feishuOpenId = 'ou_service' WHERE id = ?").bind(h.users.SERVICE.id).run();
    await h.db.prepare("UPDATE users SET feishuOpenId = 'ou_admin' WHERE id = ?").bind(h.users.ADMIN.id).run();
    aiCalls = [];
    setAiFetch((async (_url: string, init: RequestInit) => {
      aiCalls.push((init.headers as Record<string, string>).Authorization);
      const body = JSON.parse(String(init.body));
      const content = body.max_tokens <= 20 ? '{"ok": true}' : '{"summary":"客户希望支持 OCPP 2.0.1","ticketType":"PRODUCT_REQUEST","faultType":"none"}';
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
    }) as unknown as typeof fetch);
  });

  it("uses the AI key of whoever presses Create, and none for someone without a key", async () => {
    await h.request("SERVICE", "PUT", "/me/ai", { provider: "QWEN", apiKey: "sk-service-key-1" });
    aiCalls = [];

    await dm("ou_admin", "能不能支持 OCPP 2.0.1", "om_a1");
    await h.settle();
    await cardAction("ou_admin", { action: "open_draft", draftId: await lastDraftId() }, {}, "e-a-open", "om_p1");
    await h.settle();
    expect(aiCalls).toEqual([]); // the admin has no key

    await dm("ou_service", "能不能支持 OCPP 2.0.1", "om_s1");
    await h.settle();
    calls = [];
    await cardAction("ou_service", { action: "open_draft", draftId: await lastDraftId() }, {}, "e-s-open", "om_p2");
    await h.settle();
    expect(aiCalls).toEqual(["Bearer sk-service-key-1"]);
    const form = JSON.stringify(JSON.parse(messages((c) => c.method === "PATCH" && c.path === "/im/v1/messages/om_p2")[0].body.content));
    expect(form).toContain('"initial_option":"PRODUCT_REQUEST"');
    expect(form).toContain("客户希望支持 OCPP 2.0.1");
  });

  it("a product request created from Feishu is owned by its creator and written once to the requirement pool", async () => {
    await h.request("ADMIN", "PUT", "/options/requirementPoolUrl", { values: [POOL] });
    await dm("ou_service", "希望 App 能远程升级固件", "om_s2");
    await h.settle();
    const draftId = await lastDraftId();
    calls = [];
    const res = await cardAction(
      "ou_service",
      { action: "confirm_draft", draftId },
      { contactName: "Ana", customerCompany: "ACME", ticketType: "PRODUCT_REQUEST", summary: "远程升级固件", faultType: "Offline / no network" }
    );
    expect(res.body.toast.type).toBe("success");
    await h.settle();

    const ticket = await h.db.prepare("SELECT * FROM tickets").first<any>();
    expect(ticket).toMatchObject({ ticketType: "PRODUCT_REQUEST", faultType: null, summary: "远程升级固件", assignedServiceId: h.users.SERVICE.id });
    const writes = calls.filter((c) => c.path.startsWith("/bitable/v1/apps/bascnPool1/tables/tblReq1/records") && c.method === "POST");
    expect(writes).toHaveLength(1);
    expect(writes[0].body.fields).toMatchObject({ 工单号: ticket.ticketNo, 客户: "ACME", 摘要: "远程升级固件", 客户原话: "希望 App 能远程升级固件", 售后负责人: "Test SERVICE" });
    expect(ticket.bitableRecordId).toMatch(/^rec_/);

    // Classifying it again does not write a second row.
    await h.request("SERVICE", "PATCH", `/tickets/${ticket.id}/type`, { ticketType: "OTHER" });
    await h.request("SERVICE", "PATCH", `/tickets/${ticket.id}/type`, { ticketType: "PRODUCT_REQUEST" });
    await h.settle();
    expect(calls.filter((c) => c.path.startsWith("/bitable/") && c.method === "POST")).toHaveLength(1);
  });

  it("admins can check the pool table's columns", async () => {
    expect((await h.request("SERVICE", "GET", "/feishu/requirement-pool/check")).status).toBe(403);
    expect((await h.request("ADMIN", "GET", "/feishu/requirement-pool/check")).body).toMatchObject({ ok: false, error: "No requirement pool link saved yet." });
    await h.request("ADMIN", "PUT", "/options/requirementPoolUrl", { values: ["https://acme.feishu.cn/wiki/abc"] });
    expect((await h.request("ADMIN", "GET", "/feishu/requirement-pool/check")).body.error).toContain("not a Bitable table link");
    await h.request("ADMIN", "PUT", "/options/requirementPoolUrl", { values: [POOL] });
    const check = (await h.request("ADMIN", "GET", "/feishu/requirement-pool/check")).body;
    expect(check.ok).toBe(false);
    expect(check.notText).toEqual(["提交日期"]);
    expect(check.missing).toContain("客户原话");
  });

  it("a direct message saying 绑定 gets the link card instead of the ticket prompt", async () => {
    await dm("ou_someone", "绑定", "om_bind");
    await h.settle();
    const sent = messages((c) => c.body?.msg_type === "interactive");
    expect(sent).toHaveLength(1);
    expect(sent[0].body.receive_id).toBe("ou_someone");
    expect(sent[0].body.content).toContain("/api/auth/feishu/start");
    expect((await h.db.prepare("SELECT COUNT(*) AS n FROM feishuDrafts").first<{ n: number }>())?.n).toBe(0);
  });

  it("a hand-over moves the card to the new owner and marks the old one", async () => {
    const id = (await h.request("SERVICE", "POST", "/tickets", { contactName: "Li", contactInfo: "x", productId: await seedProduct(h.db), answers: {} })).body.id;
    await h.settle();
    const oldCard = (await h.db.prepare("SELECT feishuCardMessageId FROM tickets WHERE id = ?").bind(id).first<any>()).feishuCardMessageId;
    expect(oldCard).toMatch(/^om_/);
    calls = [];
    await h.request("SERVICE", "PATCH", `/tickets/${id}/assign`, { assignedServiceId: h.users.ADMIN.id });
    await h.settle();
    const toAdmin = messages((c) => c.body?.receive_id === "ou_admin" && c.body.msg_type === "interactive");
    expect(toAdmin).toHaveLength(1);
    const handedOver = messages((c) => c.method === "PATCH" && c.path === `/im/v1/messages/${oldCard}`);
    expect(handedOver[0].body.content).toContain("handed over");
    const row = await h.db.prepare("SELECT feishuCardMessageId, feishuCardOwnerId FROM tickets WHERE id = ?").bind(id).first<any>();
    expect(row).toMatchObject({ feishuCardOwnerId: h.users.ADMIN.id });
    expect(row.feishuCardMessageId).not.toBe(oldCard);
  });
});

describe("repeat faults reach the after-sales group", () => {
  it("also when a product is given to a ticket whose fault was already confirmed", async () => {
    await h.request("ADMIN", "PUT", "/options/repeatFaultThreshold", { values: ["2"] });
    const p1 = await seedProduct(h.db, "RP1");
    const p2 = await seedProduct(h.db, "RP2");
    const ticket = async (product: string) =>
      (await h.request("SERVICE", "POST", "/tickets", { customerCompany: "ACME", contactName: "Li", contactInfo: "x", productId: product, answers: {} })).body.id as string;
    const first = await ticket(p1);
    await h.request("SERVICE", "PATCH", `/tickets/${first}/fault`, { faultType: "Screen fault" });
    const second = await ticket(p2);
    await h.request("SERVICE", "PATCH", `/tickets/${second}/fault`, { faultType: "Screen fault" });
    await h.settle();
    const alerts = () =>
      messages((c) => c.body?.receive_id === SERVICE_CHAT && c.body.msg_type === "text")
        .map((c) => JSON.parse(c.body.content).text as string)
        .filter((t) => t.startsWith("Repeat fault"));
    expect(alerts()).toEqual([]);

    expect((await h.request("SERVICE", "PATCH", `/tickets/${second}/product`, { productId: p1 })).status).toBe(200);
    await h.settle();
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]).toContain('"Screen fault" 2 times in 90 days');
  });
});

describe("finding existing orders, customers and SNs in the Feishu form", () => {
  const dm = (text: string, messageId: string) =>
    push("/feishu/events", {
      schema: "2.0",
      header: { event_id: `e-${messageId}`, token: "vt", event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: "ou_service" }, sender_type: "user" },
        message: { message_id: messageId, chat_id: "oc_dm", chat_type: "p2p", message_type: "text", content: JSON.stringify({ text }) }
      }
    });
  const lastDraftId = async () => (await h.db.prepare("SELECT id FROM feishuDrafts ORDER BY rowid DESC LIMIT 1").first<{ id: string }>())!.id;
  const patchedCard = (messageId: string) => JSON.parse(messages((c) => c.method === "PATCH" && c.path === `/im/v1/messages/${messageId}`).at(-1)!.body.content);
  const inputs = (card: any) => Object.fromEntries(card.body.elements.find((e: any) => e.tag === "form").elements.filter((e: any) => e.tag === "input").map((e: any) => [e.name, e.default_value]));

  beforeEach(async () => {
    await h.db.prepare("UPDATE users SET feishuOpenId = 'ou_service' WHERE id = ?").bind(h.users.SERVICE.id).run();
    await h.db
      .prepare(
        `INSERT INTO pi (id, piNo, seq, date, language, status, customerCompany, productionOrderNo, createdById, approvedAt)
         VALUES ('pi_a', 'ZH-001', 1, '2026-10-01', 'ZH', 'APPROVED', 'Iberia Charge SL', 'PO-2026-0901', ?, CURRENT_TIMESTAMP)`
      )
      .bind(h.users.SALES.id)
      .run();
    await h.db.prepare("INSERT INTO devices (id, serialNumber, piId, createdById) VALUES ('d1', 'CHG-0901-0001', 'pi_a', ?)").bind(h.users.SERVICE.id).run();
  });

  it("an SN written in the message fills SN, order and customer", async () => {
    await dm("CHG-0901-0001 一直离线", "om_sn");
    await h.settle();
    await cardAction("ou_service", { action: "open_draft", draftId: await lastDraftId() }, {}, "e-open-sn", "om_form_sn");
    await h.settle();
    const card = patchedCard("om_form_sn");
    expect(inputs(card)).toMatchObject({ orderNo: "PO-2026-0901", customerCompany: "Iberia Charge SL" });
    // The SN is shown, not typed, and is kept on the request for the ticket.
    expect(inputs(card).serialNumber).toBeUndefined();
    expect(JSON.stringify(card)).toContain("Device SN:** CHG-0901-0001");
    const draftId = await lastDraftId();
    await cardAction("ou_service", { action: "confirm_draft", draftId }, { contactName: "Ana", serialNumber: "MADE-UP-999" }, "e-create-sn", "om_form_sn");
    await h.settle();
    expect((await h.db.prepare("SELECT serialNumber FROM tickets").first<any>())?.serialNumber).toBe("CHG-0901-0001");
  });

  it("Find lists matches and keeps what was typed; a picked match fills the ticket", async () => {
    await dm("客户的桩坏了", "om_find");
    await h.settle();
    const draftId = await lastDraftId();
    expect((await cardAction("ou_service", { action: "lookup_draft", draftId }, { lookupQuery: "0" }, "e-find-short", "om_form")).body.toast.content).toContain("at least 2");
    const found = await cardAction("ou_service", { action: "lookup_draft", draftId }, { lookupQuery: "iberia", contactName: "Ana" }, "e-find", "om_form");
    expect(found.body.toast.type).toBe("info");
    await h.settle();
    const card = patchedCard("om_form");
    const picker = card.body.elements.find((e: any) => e.tag === "form").elements.find((e: any) => e.name === "match");
    expect(picker.options.map((o: any) => o.value)).toEqual(["o:pi_a", "c:Iberia Charge SL"]);
    expect(inputs(card)).toMatchObject({ contactName: "Ana", lookupQuery: "iberia" });

    await cardAction("ou_service", { action: "confirm_draft", draftId }, { contactName: "Ana", match: "s:CHG-0901-0001" }, "e-create-match", "om_form");
    await h.settle();
    const ticket = await h.db.prepare("SELECT customerCompany, orderNo, serialNumber FROM tickets").first<any>();
    expect(ticket).toEqual({ customerCompany: "Iberia Charge SL", orderNo: "PO-2026-0901", serialNumber: "CHG-0901-0001" });
  });
});
