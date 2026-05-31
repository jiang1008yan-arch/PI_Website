import type { Language, Pi } from "../types";

export type LinkedZhState = { id: string; piNo: string; status: string } | null;

export function shouldShowLinkedZhSyncButton(language: Language, current: Pi | null): boolean {
  return language === "EN" && current != null;
}

export function shouldShowSaveAndSyncButton(language: Language, current: Pi | null): boolean {
  return language === "EN" && current == null;
}

export function canSyncLinkedZh(language: Language, current: Pi | null, linkedZh: LinkedZhState): boolean {
  return Boolean(
    shouldShowLinkedZhSyncButton(language, current) &&
    (!linkedZh || linkedZh.status === "DRAFT" || linkedZh.status === "REJECTED")
  );
}
