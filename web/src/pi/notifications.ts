// Client-side "unseen" tracking for the home-page notification badges.
//
// There is no server-side read-state, so we persist which item IDs the user has
// already seen (per category, per user) in localStorage. A badge counts only the
// IDs not yet seen; opening the matching page marks its current items as seen so
// the badge clears on the way back. The last computed count is cached too, so the
// home badge paints instantly from storage instead of popping in after the
// network round-trip (fixes the delayed-dot flicker).

export type BadgeCategory = "confirmedReceived" | "pendingReviews";

const seenKey = (category: BadgeCategory, userId: string | undefined) =>
  `pi-badge-seen:${category}:${userId ?? "anon"}`;
const countKey = (category: BadgeCategory, userId: string | undefined) =>
  `pi-badge-count:${category}:${userId ?? "anon"}`;

function readSeen(category: BadgeCategory, userId: string | undefined): Set<string> {
  try {
    const raw = localStorage.getItem(seenKey(category, userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? (parsed as string[]) : []);
  } catch {
    return new Set();
  }
}

// How many of the current items has the user not seen yet.
export function unseenCount(category: BadgeCategory, userId: string | undefined, currentIds: string[]): number {
  const seen = readSeen(category, userId);
  return currentIds.reduce((acc, id) => (seen.has(id) ? acc : acc + 1), 0);
}

// Mark every currently-listed item as seen (called when the page is opened) and
// zero the cached count so a return to the home page shows no badge instantly.
export function markAllSeen(category: BadgeCategory, userId: string | undefined, currentIds: string[]): void {
  const seen = readSeen(category, userId);
  for (const id of currentIds) seen.add(id);
  try {
    localStorage.setItem(seenKey(category, userId), JSON.stringify([...seen]));
  } catch {
    /* ignore quota / private-mode failures */
  }
  setCachedCount(category, userId, 0);
}

export function getCachedCount(category: BadgeCategory, userId: string | undefined): number {
  const n = Number(localStorage.getItem(countKey(category, userId)));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function setCachedCount(category: BadgeCategory, userId: string | undefined, n: number): void {
  try {
    localStorage.setItem(countKey(category, userId), String(n));
  } catch {
    /* ignore */
  }
}
