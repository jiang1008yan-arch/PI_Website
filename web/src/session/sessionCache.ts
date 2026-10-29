// Lists cached for the signed-in session (tickets, products, PIs): painted
// instantly on (re)entry, then revalidated by the caller. Every entry belongs
// to one user, so a second user in the same tab never sees the first one's
// lists, and the whole cache is emptied when the session ends
// (clearStoredSession: logging out, or any 401). Kept in memory and mirrored to
// sessionStorage so a reload still paints at once.

const PREFIX = "session-cache:";
// Entries written before this module existed (not keyed per user).
const LEGACY_PREFIXES = ["list-cache:", "pi-list-cache:"];

const memory = new Map<string, unknown[]>();
const entryKey = (userId: string, key: string) => `${PREFIX}${userId}:${key}`;

// The cached list, if any. Without a user nothing is cached.
export function readList<T>(userId: string | undefined, key: string): T[] | undefined {
  if (!userId) return undefined;
  const k = entryKey(userId, key);
  const inMemory = memory.get(k);
  if (inMemory) return inMemory as T[];
  try {
    const raw = sessionStorage.getItem(k);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      memory.set(k, parsed);
      return parsed as T[];
    }
  } catch {
    /* ignore malformed / unavailable storage */
  }
  return undefined;
}

export function writeList<T>(userId: string | undefined, key: string, list: T[]): void {
  if (!userId) return;
  const k = entryKey(userId, key);
  memory.set(k, list);
  try {
    sessionStorage.setItem(k, JSON.stringify(list));
  } catch {
    /* ignore quota / private-mode failures */
  }
}

// Every user's lists, and the older unkeyed ones.
export function clearSessionCache(): void {
  memory.clear();
  try {
    const keys = Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i)).filter((k): k is string => k !== null);
    for (const k of keys) {
      if (k.startsWith(PREFIX) || LEGACY_PREFIXES.some((p) => k.startsWith(p))) sessionStorage.removeItem(k);
    }
  } catch {
    /* ignore unavailable storage */
  }
}
