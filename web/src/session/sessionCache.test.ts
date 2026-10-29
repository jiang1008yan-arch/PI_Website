import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A Map-backed sessionStorage for the node test environment.
function fakeStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: (i) => [...items.keys()][i] ?? null,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, String(v)),
    removeItem: (k) => void items.delete(k),
    clear: () => items.clear()
  };
}

// A fresh module, as after a page load (the in-memory copy starts empty).
const load = async () => {
  vi.resetModules();
  return await import("./sessionCache");
};

beforeEach(() => {
  vi.stubGlobal("sessionStorage", fakeStorage());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("session cache", () => {
  it("keeps each user's lists apart", async () => {
    const cache = await load();
    cache.writeList("u_admin", "tickets:all", [{ id: "t1" }, { id: "t2" }]);
    expect(cache.readList("u_admin", "tickets:all")).toEqual([{ id: "t1" }, { id: "t2" }]);
    expect(cache.readList("u_sales", "tickets:all")).toBeUndefined();
  });

  it("caches nothing without a user", async () => {
    const cache = await load();
    cache.writeList(undefined, "tickets:all", [{ id: "t1" }]);
    expect(cache.readList(undefined, "tickets:all")).toBeUndefined();
    expect(sessionStorage.length).toBe(0);
  });

  it("paints from sessionStorage after a reload", async () => {
    (await load()).writeList("u_admin", "products", [{ id: "p1" }]);
    expect((await load()).readList("u_admin", "products")).toEqual([{ id: "p1" }]);
  });

  it("is emptied when the session ends, including entries from before it was keyed per user", async () => {
    const cache = await load();
    cache.writeList("u_admin", "tickets:all", [{ id: "t1" }]);
    sessionStorage.setItem("list-cache:tickets:all", "[]");
    sessionStorage.setItem("pi-list-cache:u_admin:EN", "[]");
    sessionStorage.setItem("token", "kept");

    cache.clearSessionCache();
    expect(cache.readList("u_admin", "tickets:all")).toBeUndefined();
    expect(Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i))).toEqual(["token"]);
  });

  it("shrugs off malformed or unavailable storage", async () => {
    sessionStorage.setItem("session-cache:u_admin:tickets:all", "{not json");
    const cache = await load();
    expect(cache.readList("u_admin", "tickets:all")).toBeUndefined();

    vi.stubGlobal("sessionStorage", {
      get length(): number {
        throw new Error("blocked");
      },
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      }
    });
    cache.writeList("u_admin", "products", [{ id: "p1" }]);
    expect(cache.readList("u_admin", "products")).toEqual([{ id: "p1" }]);
    expect(() => cache.clearSessionCache()).not.toThrow();
  });
});
