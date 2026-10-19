// Persistent PI-list cache.
//
// The list cache used to be a useRef inside usePiEditor, which was wiped every
// time the PI page unmounted — so navigating Home -> English/Chinese PI was
// always a cold network wait before anything painted. This cache lives at module
// scope and mirrors to sessionStorage (keyed per user + language), so:
//   - re-entering the PI page paints the last-known list instantly, then
//     revalidates in the background (stale-while-revalidate), and
//   - the home page can warm it ahead of navigation via prefetchPiList.
import { api } from "../api/client";
import type { Language, Pi } from "../types";

const memory = new Map<string, Pi[]>();

const key = (userId: string | undefined, language: Language) => `${userId ?? "anon"}:${language}`;
const storageKey = (userId: string | undefined, language: Language) => `pi-list-cache:${key(userId, language)}`;

export function getCachedList(userId: string | undefined, language: Language): Pi[] | undefined {
  const k = key(userId, language);
  const inMemory = memory.get(k);
  if (inMemory) return inMemory;
  try {
    const raw = sessionStorage.getItem(storageKey(userId, language));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      memory.set(k, parsed as Pi[]);
      return parsed as Pi[];
    }
  } catch {
    /* ignore malformed / unavailable storage */
  }
  return undefined;
}

export function setCachedList(userId: string | undefined, language: Language, list: Pi[]): void {
  memory.set(key(userId, language), list);
  try {
    sessionStorage.setItem(storageKey(userId, language), JSON.stringify(list));
  } catch {
    /* ignore quota / private-mode failures */
  }
}

// Best-effort warm of the cache ahead of navigation (called from the home page)
// so even the first visit to the PI page is instant.
export async function prefetchPiList(userId: string | undefined, language: Language): Promise<void> {
  try {
    const res = await api.get(`/pi?language=${language}`);
    setCachedList(userId, language, (res.data as Pi[]).filter((p) => p.language === language));
  } catch {
    /* best effort — the PI page will load normally if this fails */
  }
}
