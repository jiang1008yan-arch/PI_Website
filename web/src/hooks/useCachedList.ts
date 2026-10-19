import { useCallback, useEffect, useRef, useState } from "react";

// Generic stale-while-revalidate cache for a "section list" (tickets, products,
// …). Same principle as the PI list cache: paint the last-known list instantly
// on (re)entry from a module-level + sessionStorage cache, then revalidate in
// the background. Encode any query params in `key` (e.g. `tickets:NEW`) so a
// param change is a different cache entry; call `refresh` after a mutation to
// re-pull and update the cache.

const memory = new Map<string, unknown[]>();
const storageKey = (key: string) => `list-cache:${key}`;

function read<T>(key: string): T[] | undefined {
  const inMemory = memory.get(key);
  if (inMemory) return inMemory as T[];
  try {
    const raw = sessionStorage.getItem(storageKey(key));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      memory.set(key, parsed);
      return parsed as T[];
    }
  } catch {
    /* ignore malformed / unavailable storage */
  }
  return undefined;
}

function write<T>(key: string, list: T[]): void {
  memory.set(key, list);
  try {
    sessionStorage.setItem(storageKey(key), JSON.stringify(list));
  } catch {
    /* ignore quota / private-mode failures */
  }
}

export function useCachedList<T>(key: string, fetcher: () => Promise<T[]>) {
  const [data, setData] = useState<T[]>(() => read<T>(key) ?? []);
  const [loading, setLoading] = useState(() => read<T>(key) === undefined);
  // Track the latest requested key so an out-of-order response for a previous
  // key (e.g. after a fast filter switch) can't clobber the current view.
  const latestKey = useRef(key);
  latestKey.current = key;

  const refresh = useCallback(async () => {
    const myKey = key;
    setLoading(true);
    try {
      const list = await fetcher();
      write(myKey, list);
      if (latestKey.current === myKey) setData(list);
    } finally {
      if (latestKey.current === myKey) setLoading(false);
    }
    // fetcher is intentionally omitted: it is recreated each render but is
    // pinned to `key`, which already changes whenever its inputs do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    setData(read<T>(key) ?? []);
    setLoading(read<T>(key) === undefined);
    void refresh();
  }, [key, refresh]);

  return { data, loading, refresh };
}
