import { messageContentToText } from "./client";

// What a Feishu message contributes to a ticket request (pure): its text and
// the pictures, voice messages, videos and files in it. Merged forwards are
// expanded by the caller (they need an API call); their sub-messages come
// through here with `insideForward`, because Feishu does not let bots download
// files inside a merged forward.

export type MaterialKind = "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "FILE";

export type Material = {
  kind: MaterialKind;
  sourceMessageId: string;
  text?: string;
  // The file to download: its key and the resource type the download API wants.
  fileKey?: string;
  resourceType?: "image" | "file";
  fileName?: string;
  durationMs?: number;
  insideForward: boolean;
};

function parse(content: unknown): any {
  if (typeof content !== "string") return content ?? {};
  try {
    return JSON.parse(content);
  } catch {
    return {};
  }
}

const duration = (value: unknown) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.round(Number(value)) : undefined);

export function materialsFromContent(msgType: string, content: unknown, messageId: string, insideForward = false): Material[] {
  const base = { sourceMessageId: messageId, insideForward };
  const c = parse(content);
  switch (msgType) {
    case "text": {
      const text = messageContentToText("text", c);
      return text ? [{ ...base, kind: "TEXT", text }] : [];
    }
    case "post": {
      // Rich text can carry pictures and videos between its lines.
      const out: Material[] = [];
      const text = messageContentToText("post", c);
      if (text) out.push({ ...base, kind: "TEXT", text });
      const post = c?.content ? c : c?.zh_cn ?? c?.en_us ?? Object.values(c ?? {})[0];
      for (const line of (post as any)?.content ?? []) {
        for (const seg of Array.isArray(line) ? line : []) {
          if (seg?.tag === "img" && seg.image_key) out.push({ ...base, kind: "IMAGE", fileKey: String(seg.image_key), resourceType: "image" });
          if (seg?.tag === "media" && seg.file_key) out.push({ ...base, kind: "VIDEO", fileKey: String(seg.file_key), resourceType: "file" });
        }
      }
      return out;
    }
    case "image":
      return c?.image_key ? [{ ...base, kind: "IMAGE", fileKey: String(c.image_key), resourceType: "image" }] : [];
    case "audio":
      return c?.file_key ? [{ ...base, kind: "AUDIO", fileKey: String(c.file_key), resourceType: "file", durationMs: duration(c.duration) }] : [];
    case "media":
      return c?.file_key
        ? [{ ...base, kind: "VIDEO", fileKey: String(c.file_key), resourceType: "file", fileName: c.file_name ? String(c.file_name) : undefined, durationMs: duration(c.duration) }]
        : [];
    case "file":
      return c?.file_key ? [{ ...base, kind: "FILE", fileKey: String(c.file_key), resourceType: "file", fileName: c.file_name ? String(c.file_name) : undefined }] : [];
    default:
      // Stickers, cards, shared chats and the like carry nothing for a ticket.
      return [];
  }
}

// The sub-messages of a merged forward as returned by the "get message" API
// (the forward itself first), flattened into materials, plus the one chat
// they all came from, if they share one.
export function materialsFromForward(
  items: { message_id: string; msg_type: string; chat_id?: string; upper_message_id?: string; body?: { content?: string } }[],
  forwardId: string
): { materials: Material[]; chatId: string | null } {
  const subs = items.filter((i) => i.message_id !== forwardId && i.msg_type !== "merge_forward");
  const chats = new Set(subs.map((i) => i.chat_id).filter(Boolean));
  return {
    materials: subs.flatMap((i) => materialsFromContent(i.msg_type, i.body?.content, i.message_id, true)),
    chatId: chats.size === 1 ? [...chats][0]! : null
  };
}
