import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { readList, writeList } from "../session/sessionCache";

// Generic stale-while-revalidate cache for a "section list" (tickets, products,
// …). Same principle as the PI list cache: paint the signed-in user's last-known
// list instantly on (re)entry from the session cache, then revalidate in the
// background. Encode any query params in `key` (e.g. `tickets:NEW`) so a
// param change is a different cache entry; call `refresh` after a mutation to
// re-pull and update the cache.

export function useCachedList<T>(key: string, fetcher: () => Promise<T[]>) {
  const userId = useAuth().user?.id;
  const [data, setData] = useState<T[]>(() => readList<T>(userId, key) ?? []);
  const [loading, setLoading] = useState(() => readList<T>(userId, key) === undefined);
  // Track the latest requested user + key so an out-of-order response for a
  // previous one (e.g. after a fast filter switch) can't clobber the current view.
  const current = `${userId ?? ""}|${key}`;
  const latest = useRef(current);
  latest.current = current;

  const refresh = useCallback(async () => {
    const mine = current;
    setLoading(true);
    try {
      const list = await fetcher();
      writeList(userId, key, list);
      if (latest.current === mine) setData(list);
    } finally {
      if (latest.current === mine) setLoading(false);
    }
    // fetcher is intentionally omitted: it is recreated each render but is
    // pinned to `key`, which already changes whenever its inputs do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, key]);

  useEffect(() => {
    setData(readList<T>(userId, key) ?? []);
    setLoading(readList<T>(userId, key) === undefined);
    void refresh();
  }, [userId, key, refresh]);

  return { data, loading, refresh };
}
