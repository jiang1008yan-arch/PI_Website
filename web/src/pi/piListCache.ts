// Persistent PI-list cache.
//
// The list cache used to be a useRef inside usePiEditor, which was wiped every
// time the PI page unmounted — so navigating Home -> English/Chinese PI was
// always a cold network wait before anything painted. This cache lives at module
// in the session cache (per user + language, emptied when the session ends), so:
//   - re-entering the PI page paints the last-known list instantly, then
//     revalidates in the background (stale-while-revalidate), and
//   - the home page can warm it ahead of navigation via prefetchPiList.
import { api } from "../api/client";
import { readList, writeList } from "../session/sessionCache";
import type { Language, Pi } from "../types";

const key = (language: Language) => `pi:${language}`;

export function getCachedList(userId: string | undefined, language: Language): Pi[] | undefined {
  return readList<Pi>(userId, key(language));
}

export function setCachedList(userId: string | undefined, language: Language, list: Pi[]): void {
  writeList(userId, key(language), list);
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
