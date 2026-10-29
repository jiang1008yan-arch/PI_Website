import { afterEach, describe, expect, it, vi } from "vitest";
import { call, download, FeishuApiError, setBotFetch, type FeishuApp } from "./transport";

// The Feishu transport both bots share: tokens per app, one fake per bot, and
// the error rule.

const afterSales: FeishuApp = { bot: "afterSales", appId: "cli_as", appSecret: "s1" };
const pi: FeishuApp = { bot: "pi", appId: "cli_pi", appSecret: "s2" };

type Seen = { url: string; auth: string | null };
function fake(answer: (path: string) => unknown = () => ({ code: 0, data: { ok: true } })) {
  const seen: Seen[] = [];
  let issued = 0;
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace("/open-apis", "");
    seen.push({ url: path, auth: new Headers(init?.headers).get("authorization") });
    const body = path.startsWith("/auth/") ? { code: 0, tenant_access_token: `t-${++issued}`, expire: 7200 } : answer(path);
    return body instanceof Response ? body : new Response(JSON.stringify(body));
  }) as typeof fetch;
  return { impl, seen, tokenRequests: () => seen.filter((s) => s.url.startsWith("/auth/")).length };
}

afterEach(() => {
  setBotFetch("afterSales", null);
  setBotFetch("pi", null);
  vi.useRealTimers();
});

describe("tenant tokens", () => {
  it("are fetched once per app and reused", async () => {
    const f = fake();
    setBotFetch("afterSales", f.impl);
    await call(afterSales, "GET", "/im/v1/chats");
    await call(afterSales, "GET", "/im/v1/chats");
    expect(f.tokenRequests()).toBe(1);
    expect(f.seen.at(-1)!.auth).toBe("Bearer t-1");
  });

  it("are refreshed 5 minutes before they expire", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-29T00:00:00Z") });
    const f = fake();
    setBotFetch("afterSales", f.impl);
    await call(afterSales, "GET", "/im/v1/chats");
    vi.setSystemTime(new Date("2026-10-29T01:54:00Z"));
    await call(afterSales, "GET", "/im/v1/chats");
    expect(f.tokenRequests()).toBe(1);
    vi.setSystemTime(new Date("2026-10-29T01:56:00Z"));
    await call(afterSales, "GET", "/im/v1/chats");
    expect(f.tokenRequests()).toBe(2);
  });
});

describe("one fake per bot", () => {
  it("each bot's calls reach only its own fake, and replacing a fake drops that bot's token", async () => {
    const forAfterSales = fake();
    const forPi = fake();
    setBotFetch("afterSales", forAfterSales.impl);
    setBotFetch("pi", forPi.impl);
    await call(afterSales, "POST", "/im/v1/messages", { a: 1 });
    await call(pi, "POST", "/im/v1/messages", { b: 1 });
    expect(forAfterSales.seen.map((s) => s.url)).toEqual(["/auth/v3/tenant_access_token/internal", "/im/v1/messages"]);
    expect(forPi.seen.map((s) => s.url)).toEqual(["/auth/v3/tenant_access_token/internal", "/im/v1/messages"]);

    const again = fake();
    setBotFetch("pi", again.impl);
    await call(pi, "GET", "/im/v1/chats");
    await call(afterSales, "GET", "/im/v1/chats");
    expect(again.tokenRequests()).toBe(1);
    expect(forAfterSales.tokenRequests()).toBe(1);
  });
});

describe("answers and errors", () => {
  it("returns Feishu's whole answer; a user token or none replaces the tenant token", async () => {
    const f = fake();
    setBotFetch("pi", f.impl);
    expect(await call(pi, "GET", "/authen/v1/user_info", undefined, "u-1")).toEqual({ code: 0, data: { ok: true } });
    await call(pi, "POST", "/authen/v2/oauth/token", { code: "x" }, null);
    expect(f.seen.map((s) => s.auth)).toEqual(["Bearer u-1", null]);
    expect(f.tokenRequests()).toBe(0);
  });

  it("a non-zero code or an HTTP error is a FeishuApiError naming the call", async () => {
    setBotFetch("afterSales", fake((path) => (path.includes("bitable") ? { code: 91402, msg: "NOTEXIST" } : new Response("{}", { status: 502, statusText: "Bad Gateway" }))).impl);
    const refused = await call(afterSales, "GET", "/bitable/v1/apps/x/tables/y/fields").catch((e) => e);
    expect(refused).toBeInstanceOf(FeishuApiError);
    expect(refused).toMatchObject({ code: 91402, message: "Feishu GET /bitable/v1/apps/x/tables/y/fields: 91402 NOTEXIST" });
    await expect(call(afterSales, "GET", "/im/v1/chats")).rejects.toMatchObject({ code: 502, message: "Feishu GET /im/v1/chats: 502 Bad Gateway" });
  });

  it("a refused token says so", async () => {
    setBotFetch("afterSales", (async () => new Response(JSON.stringify({ code: 10003, msg: "invalid app_id" }))) as typeof fetch);
    await expect(call(afterSales, "GET", "/im/v1/chats")).rejects.toThrow("Feishu token: 10003 invalid app_id");
  });

  it("a download hands back the raw response, signed with the tenant token", async () => {
    const f = fake(() => new Response("bytes", { headers: { "content-type": "image/png" } }));
    setBotFetch("afterSales", f.impl);
    const res = await download(afterSales, "/im/v1/messages/om_1/resources/img_1?type=image");
    expect(await res.text()).toBe("bytes");
    expect(f.seen.at(-1)!.auth).toBe("Bearer t-1");
  });
});
