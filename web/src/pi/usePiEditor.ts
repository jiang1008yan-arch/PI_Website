import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { Language, Pi, PiItem, User } from "../types";
import { getMeta } from "./lineItemFields";
import { canDeletePiByStatus, canEditPiDirectly, isReviewerEditMode } from "../../../shared/piCapabilities";
import { isConfirmedReceivedPi, piDisplayName } from "./labels";
import { isPiDirty, type PiSnapshot } from "./piDiff";
import { parsePiItems } from "./piItemCodec";
import { parseField } from "../products/productFields";
import { canSyncLinkedZh, type LinkedZhState } from "./linkedZhSync";

const today = () => new Date().toISOString().slice(0, 10);
const EXCEL_DOWNLOAD_TIMEOUT_MS = 45000;
const DISCARD_PROMPT = "You have unsaved changes. Discard them?";

export type UsePiEditorParams = {
  language: Language;
  user: User | null;
  linkedPiId: string | null;
  senderDefaults: Record<string, string>;
  setSearchParams: SetURLSearchParams;
};

export function usePiEditor({ language, user, linkedPiId, senderDefaults, setSearchParams }: UsePiEditorParams) {
  const [pis, setPis] = useState<Pi[]>([]);
  const [current, setCurrent] = useState<Pi | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [items, setItems] = useState<PiItem[]>([]);
  const [header, setHeader] = useState<any>({ language, date: today(), customerCompany: "" });
  const [assignedToId, setAssignedToId] = useState("");
  const [canonical, setCanonical] = useState<PiSnapshot | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [exporting, setExporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exportError, setExportError] = useState("");
  const fieldOptionsCache = useRef(new Map<string, {
    optionsByLabel: Map<string, string[]>;
    typeByLabel: Map<string, string>;
  }>());
  // 需求1 — linked ZH draft state for the EN editor (resync target + notices).
  const [linkedZh, setLinkedZh] = useState<LinkedZhState>(null);
  const [linkedNotice, setLinkedNotice] = useState("");
  const [resyncing, setResyncing] = useState(false);
  const canResyncZh = canSyncLinkedZh(language, current, linkedZh);

  const canEditPendingZh = Boolean(user && current && isReviewerEditMode(user.role, language, current.status));
  const canConfirmReceivedZh = canEditPendingZh;
  const locked = Boolean(language === "ZH" && current && !canEditPiDirectly(language, current.status) && !canEditPendingZh);
  const activePis = language === "ZH"
    ? pis.filter((p) => p.status !== "APPROVED" && !isConfirmedReceivedPi(p, user?.id))
    : pis;

  const snapshot = (): PiSnapshot => ({ header: { ...header, language, items: undefined }, items });

  const isDirty = useMemo(
    () => isPiDirty(canonical, snapshot()),
    [canonical, header, items, language]
  );

  const hasBufferedEdits = canConfirmReceivedZh && isDirty;

  const total = useMemo(
    () => items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.unitPrice) * (1 - Number(it.discountPct) / 100), 0),
    [items]
  );
  const totalCurrency = getMeta(items[0], "currency") || "USD";

  useEffect(() => {
    if (!hasBufferedEdits) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasBufferedEdits]);

  useEffect(() => {
    void reload();
  }, [language]);

  useEffect(() => {
    fieldOptionsCache.current.clear();
  }, [language]);

  useEffect(() => {
    if (language === "ZH" && linkedPiId) void open(linkedPiId);
  }, [language, linkedPiId]);

  useEffect(() => {
    if (language !== "EN") return;
    setHeader((prev: any) => prev.language === "EN" ? { ...senderDefaults, ...prev } : prev);
  }, [senderDefaults, language]);

  async function loadFieldOptions(productId: string) {
    const key = `${language}:${productId}`;
    const cached = fieldOptionsCache.current.get(key);
    if (cached) return cached;
    const res = await api.get(`/products/${productId}/fields?language=${language}`);
    const fields = res.data.map(parseField);
    const options = {
      optionsByLabel: new Map<string, string[]>(
        fields.map((field: any) => [String(field.label), field.options ?? []])
      ),
      typeByLabel: new Map<string, string>(
        fields.map((field: any) => [String(field.label), String(field.fieldType)])
      )
    };
    fieldOptionsCache.current.set(key, options);
    return options;
  }

  async function hydrateFieldOptions<T extends PiItem>(itemsToHydrate: T[]): Promise<T[]> {
    const productIds = Array.from(new Set(itemsToHydrate.map((item) => item.productId)));
    await Promise.all(productIds.map(async (productId) => {
      try {
        await loadFieldOptions(productId);
      } catch {
        // Keep the saved item data usable even if field metadata fails to load.
      }
    }));
    return itemsToHydrate.map((item) => {
      const metadata = fieldOptionsCache.current.get(`${language}:${item.productId}`);
      if (!metadata) return item;
      return {
        ...item,
        fieldValues: item.fieldValues.map((field) => ({
          ...field,
          fieldType: metadata.typeByLabel.get(field.label) ?? field.fieldType,
          options: metadata.optionsByLabel.get(field.label) ?? field.options ?? []
        }))
      };
    });
  }

  async function reload() {
    const res = await api.get("/pi");
    setPis(res.data.filter((x: Pi) => x.language === language));
  }

  async function open(id: string) {
    const res = await api.get(`/pi/${id}`);
    setCurrent(res.data.pi);
    setHeader(res.data.pi);
    setAssignedToId((cur) => res.data.pi.assignedToId ?? cur);
    const hydrated = await hydrateFieldOptions(parsePiItems(res.data.items));
    setItems(hydrated);
    setEvents(res.data.events ?? []);
    setCanonical({ header: { ...res.data.pi }, items: hydrated });
    setRejectNote("");
    if (language === "EN" && res.data.pi.linkedPiId && res.data.pi.linkedPiNo && res.data.pi.linkedPiStatus) {
      setLinkedZh({
        id: res.data.pi.linkedPiId,
        piNo: res.data.pi.linkedPiNo,
        status: res.data.pi.linkedPiStatus
      });
    } else {
      setLinkedZh(null);
    }
  }

  function clearState() {
    if (language === "ZH") setSearchParams({});
    setCurrent(null);
    setHeader({ ...(language === "EN" ? senderDefaults : {}), language, date: today(), customerCompany: "" });
    setItems([]);
    setEvents([]);
    setCanonical(null);
    setRejectNote("");
    setLinkedZh(null);
    setLinkedNotice("");
  }

  function reset() {
    if (isDirty && !window.confirm(DISCARD_PROMPT)) return;
    clearState();
  }

  function selectPi(id: string) {
    if (current?.id !== id && isDirty && !window.confirm(DISCARD_PROMPT)) return;
    if (language === "ZH") setSearchParams({ piId: id });
    void open(id);
  }

  function buildSavePayload() {
    return {
      ...header,
      customerCompany: language === "ZH" ? (header.customerCompany || "Chinese PI") : header.customerCompany,
      language,
      items
    };
  }

  async function save(e?: FormEvent): Promise<string | undefined> {
    e?.preventDefault();
    if (saving) return current?.id;
    setSaving(true);
    const payload = buildSavePayload();
    try {
      if (current) {
        await api.patch(`/pi/${current.id}`, payload);
        await open(current.id);
        await reload();
        return current.id;
      }
      const res = await api.post("/pi", payload);
      if (language === "EN" && res.data.linkedZhPiNo) {
        setLinkedNotice(`Linked Chinese draft ${res.data.linkedZhPiNo} created. Open the Chinese workspace to review it.`);
      }
      await open(res.data.id);
      await reload();
      return res.data.id as string;
    } finally {
      setSaving(false);
    }
  }

  async function resyncZh() {
    if (!current) return;
    const message = linkedZh
      ? "Rebuild the linked Chinese draft's product rows from the latest English data? Chinese-only header fields (production order no, customer source/type, delivery date) are kept."
      : "Create a linked Chinese draft from this English PI?";
    if (!window.confirm(message)) return;
    setExportError("");
    setLinkedNotice("");
    setResyncing(true);
    try {
      if (isDirty) {
        setSaving(true);
        await api.patch(`/pi/${current.id}`, buildSavePayload());
      }
      const res = await api.post(`/pi/${current.id}/resync-zh`);
      setLinkedNotice(
        res.data.created
          ? `Linked Chinese draft ${res.data.linkedZhPiNo} created. Open the Chinese workspace to review it.`
          : "Chinese draft re-synced from the latest English data."
      );
      await open(current.id);
    } catch (err: any) {
      setExportError(err.response?.data?.error ?? err.message ?? "Re-sync failed.");
    } finally {
      setResyncing(false);
      setSaving(false);
    }
  }

  async function submit() {
    const id = current?.id ?? await save();
    if (!id) return;
    await api.post(
      language === "ZH" ? `/pi/${id}/submit-for-review` : `/pi/${id}/submit`,
      language === "ZH" ? { assignedToId } : {}
    );
    await open(id);
    await reload();
  }

  async function confirmReceivedPi() {
    if (!current || !canonical) return;
    setExportError("");
    setConfirming(true);
    try {
      // Edits flow as `{pi, items}`. Approval with no edits sends `{}` — the
      // server picks APPROVED either way and the "was it edited" question is
      // answered by comparing pi.submittedSnapshot to the live row.
      const payload = isDirty
        ? {
            pi: { ...header, customerCompany: header.customerCompany || "Chinese PI", language },
            items
          }
        : {};
      await api.post(`/pi/${current.id}/approve`, payload);
      await open(current.id);
      await reload();
    } catch (err: any) {
      setExportError(err.response?.data?.error ?? err.message ?? "Confirm failed.");
    } finally {
      setConfirming(false);
    }
  }

  async function rejectReview() {
    if (!current || !canonical) return;
    if (!rejectNote.trim()) {
      setExportError("Please add a rejection note so the submitter knows what to fix.");
      return;
    }
    setExportError("");
    setRejecting(true);
    try {
      await api.post(`/pi/${current.id}/reject`, { note: rejectNote.trim() });
      clearState();
      await reload();
    } catch (err: any) {
      setExportError(err.response?.data?.error ?? err.message ?? "Reject failed.");
    } finally {
      setRejecting(false);
    }
  }

  async function deleteDraft(pi: Pi) {
    if (!canDeletePiByStatus(language, pi.status)) return;
    const ok = window.confirm(`Delete ${language === "EN" ? "PI" : "draft"} ${piDisplayName(pi, language)}?`);
    if (!ok) return;
    await api.delete(`/pi/${pi.id}`);
    if (current?.id === pi.id) clearState();
    await reload();
  }

  async function downloadExcel() {
    if (!current) return;
    setExportError("");
    setExporting(true);
    try {
      await withTimeout(async () => {
        const id = locked ? current.id : await save();
        if (id) {
          const { exportPi } = await import("../excel/exportPi");
          await exportPi(id);
        }
      }, EXCEL_DOWNLOAD_TIMEOUT_MS);
    } catch (err: any) {
      setExportError(err.response?.data?.error ?? err.message ?? "Excel download failed.");
    } finally {
      setExporting(false);
    }
  }

  return {
    // PI list
    pis, activePis,
    // Current PI state
    current, header, items, events, canonical, assignedToId, rejectNote,
    // UI flags
    exporting, confirming, rejecting, saving, exportError, resyncing,
    // Linked ZH (需求1)
    linkedZh, linkedNotice, canResyncZh,
    // Derived
    locked, canEditPendingZh, canConfirmReceivedZh, hasBufferedEdits, isDirty,
    total, totalCurrency,
    // Setters
    setHeader, setItems, setAssignedToId, setRejectNote, setExportError, setLinkedNotice,
    // Actions
    reload, open, reset, clearState, selectPi, save, submit,
    confirmReceivedPi, rejectReview, deleteDraft, downloadExcel, resyncZh
  };
}

async function withTimeout<T>(task: () => Promise<T>, ms: number): Promise<T> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      task(),
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(
          () => reject(new Error("Excel download took too long. Please refresh the page and try again.")),
          ms
        );
      })
    ]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
}
