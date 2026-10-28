import { describe, expect, it } from "vitest";
import { compileDraftText, isDraftExpired } from "./drafts";
import { materialsFromContent, materialsFromForward } from "./materials";

describe("what a Feishu message contributes to a ticket request", () => {
  it("texts, pictures, voice messages, videos and files", () => {
    expect(materialsFromContent("text", JSON.stringify({ text: "@_user_1 黑屏" }), "m1")).toEqual([{ sourceMessageId: "m1", insideForward: false, kind: "TEXT", text: "黑屏" }]);
    expect(materialsFromContent("image", '{"image_key":"img_1"}', "m2")).toMatchObject([{ kind: "IMAGE", fileKey: "img_1", resourceType: "image" }]);
    expect(materialsFromContent("audio", '{"file_key":"f1","duration":12345}', "m3")).toMatchObject([{ kind: "AUDIO", fileKey: "f1", resourceType: "file", durationMs: 12345 }]);
    expect(materialsFromContent("media", '{"file_key":"f2","image_key":"t","file_name":"a.mp4","duration":3000}', "m4")).toMatchObject([
      { kind: "VIDEO", fileKey: "f2", resourceType: "file", fileName: "a.mp4", durationMs: 3000 }
    ]);
    expect(materialsFromContent("file", '{"file_key":"f3","file_name":"log.txt"}', "m5")).toMatchObject([{ kind: "FILE", fileKey: "f3", fileName: "log.txt" }]);
  });

  it("rich text gives its text and the pictures and videos between its lines", () => {
    const post = { zh_cn: { title: "故障", content: [[{ tag: "text", text: "屏幕" }, { tag: "img", image_key: "img_9" }], [{ tag: "media", file_key: "f9" }]] } };
    expect(materialsFromContent("post", JSON.stringify(post), "m6").map((m) => [m.kind, m.text ?? m.fileKey])).toEqual([
      ["TEXT", "故障\n屏幕"],
      ["IMAGE", "img_9"],
      ["VIDEO", "f9"]
    ]);
  });

  it("nothing from stickers, cards, empty texts or broken content", () => {
    expect(materialsFromContent("sticker", '{"file_key":"s"}', "m")).toEqual([]);
    expect(materialsFromContent("interactive", "{}", "m")).toEqual([]);
    expect(materialsFromContent("text", '{"text":"  @_user_1 "}', "m")).toEqual([]);
    expect(materialsFromContent("image", "not json", "m")).toEqual([]);
  });

  it("a merged forward: its sub-messages, marked as inside it, and the one chat they came from", () => {
    const sub = (id: string, msg_type: string, content: unknown, chat_id = "oc_customer") => ({ message_id: id, msg_type, chat_id, upper_message_id: "fwd", body: { content: JSON.stringify(content) } });
    const items = [{ message_id: "fwd", msg_type: "merge_forward", body: { content: "Merged and Forwarded Message" } }, sub("s1", "text", { text: "offline" }), sub("s2", "image", { image_key: "k" })];
    const out = materialsFromForward(items, "fwd");
    expect(out.chatId).toBe("oc_customer");
    expect(out.materials.map((m) => [m.kind, m.sourceMessageId, m.insideForward])).toEqual([
      ["TEXT", "s1", true],
      ["IMAGE", "s2", true]
    ]);
    expect(materialsFromForward([...items, sub("s3", "text", { text: "x" }, "oc_other")], "fwd").chatId).toBeNull();
  });
});

describe("a ticket request's text and time limit", () => {
  it("one line per item, files as placeholders, voice with its transcript", () => {
    expect(
      compileDraftText([
        { kind: "TEXT", text: "黑屏", fileName: null, durationMs: null },
        { kind: "IMAGE", text: null, fileName: null, durationMs: null },
        { kind: "AUDIO", text: "一直报 E12", fileName: null, durationMs: 65000 },
        { kind: "VIDEO", text: null, fileName: "a.mp4", durationMs: null },
        { kind: "FILE", text: null, fileName: "log.txt", durationMs: null }
      ])
    ).toBe("黑屏\n[Picture]\n[Voice message 1:05] 一直报 E12\n[Video]\n[File: log.txt]");
  });

  it("counts six hours from the last addition; device alerts never expire", () => {
    const now = new Date("2026-10-27T12:00:00Z");
    expect(isDraftExpired({ createdAt: "2026-10-27 05:00:00" }, now)).toBe(true);
    expect(isDraftExpired({ createdAt: "2026-10-27 05:00:00", updatedAt: "2026-10-27 07:00:00" }, now)).toBe(false);
    expect(isDraftExpired({ createdAt: "2026-10-27 11:00:00", expiredAt: "2026-10-27 11:30:00" }, now)).toBe(true);
    expect(isDraftExpired({ createdAt: "2026-10-01 00:00:00", kind: "DEVICE_ALERT" }, now)).toBe(false);
  });

  it("gives Add to ticket 30 minutes from the last addition", () => {
    const now = new Date("2026-10-27T12:00:00Z");
    expect(isDraftExpired({ createdAt: "2026-10-27 11:40:00", targetTicketId: "t1" }, now)).toBe(false);
    expect(isDraftExpired({ createdAt: "2026-10-27 11:20:00", targetTicketId: "t1" }, now)).toBe(true);
    expect(isDraftExpired({ createdAt: "2026-10-27 11:00:00", updatedAt: "2026-10-27 11:45:00", targetTicketId: "t1" }, now)).toBe(false);
  });
});
