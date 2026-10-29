import type { Context } from "hono";
import { readIncoming, type FeishuSecrets, type Incoming } from "./crypto";

// What both bots' endpoints do with a request Feishu pushes to them: check it
// came from Feishu, drop a repeat, answer a card button with a toast, and do
// slow work after answering (Feishu wants an answer within 3s).

// Authenticates and decodes the request with the bot's secrets.
export async function readFeishuRequest(c: Context, secrets: FeishuSecrets): Promise<Incoming> {
  return await readIncoming(
    await c.req.text(),
    {
      timestamp: c.req.header("x-lark-request-timestamp") ?? null,
      nonce: c.req.header("x-lark-request-nonce") ?? null,
      signature: c.req.header("x-lark-signature") ?? null
    },
    secrets
  );
}

// True the first time a key is seen; Feishu may push an event twice.
export async function firstSeen(db: D1Database, key: string): Promise<boolean> {
  const res = await db.prepare("INSERT OR IGNORE INTO feishuSeenEvents (eventKey) VALUES (?)").bind(key).run();
  return (res.meta?.changes ?? 0) > 0;
}

export const toast = (type: "success" | "info" | "warning" | "error", content: string) => ({ toast: { type, content } });

// Runs after the answer is sent; a failure is logged with `failure`.
export function runLater(c: Context, task: () => Promise<unknown>, failure = "Feishu background task failed") {
  const promise = task().catch((error) => console.error(failure, error));
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    void promise;
  }
}
