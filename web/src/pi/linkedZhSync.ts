import type { Language, Pi } from "../types";

export type LinkedZhState = { id: string; piNo: string; status: string } | null;

// The Sync button is always visible on the English workspace so users know the
// feature exists; it is only *enabled* once the PI is saved and the linked
// Chinese draft is still editable (see canSyncLinkedZh).
export function shouldShowLinkedZhSyncButton(language: Language): boolean {
  return language === "EN";
}

export function canSyncLinkedZh(language: Language, current: Pi | null, linkedZh: LinkedZhState): boolean {
  return Boolean(
    language === "EN" &&
    current != null &&
    (!linkedZh || linkedZh.status === "DRAFT" || linkedZh.status === "REJECTED")
  );
}
