import { FormEvent, useEffect, useMemo, useState } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { Language, Pi, PiItem, User } from "../types";
import { getMeta } from "./fieldValues";
import { isConfirmedReceivedPi, piDisplayName } from "./labels";
import { computePiDiff, isPiDirty, type PiSnapshot } from "./piDiff";
import { parsePiItems } from "./piItemCodec";
import { parseField } from "../products/productFields";

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
  const [exportError, setExportError] = useState("");

  const canEditPendingZh = language === "ZH" && current?.status === "PENDING_REVIEW" && user?.role === "ADMIN";
  const canConfirmReceivedZh = canEditPendingZh;
  const locked = Boolean(language === "ZH" && current && !["DRAFT", "REJECTED"].includes(current.status) && !canEditPendingZh);
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
    if (language === "ZH" && linkedPiId) void open(linkedPiId);
  }, [language, linkedPiId]);

  useEffect(() => {
    if (language !== "EN") return;
    setHeader((prev: any) => prev.language === "EN" ? { ...senderDefaults, ...prev } : prev);
  }, [senderDefaults, language]);

  async function hydrateFieldOptions<T extends PiItem>(itemsToHydrate: T[]): Promise<T[]> {
    return Promise.all(itemsToHydrate.map(async (item) => {
      try {
        const res = await api.get(`/products/${item.productId}/fields?language=${language}`);
        const fields = res.data.map(parseField);
        const optionsByLabel = new Map<string, string[]>(
          fields.map((field: any) => [String(field.label), field.options ?? []])
        );
        const typeByLabel = new Map<string, string>(
          fields.map((field: any) => [String(field.label), String(field.fieldType)])
        );
        return {
          ...item,
          fieldValues: item.fieldValues.map((field) => ({
            ...field,
            fieldType: typeByLabel.get(field.label) ?? field.fieldType,
            options: optionsByLabel.get(field.label) ?? field.options ?? []
          }))
        };
      } catch {
        return item;
      }
    }));
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
  }

  function clearState() {
    if (language === "ZH") setSearchParams({});
    setCurrent(null);
    setHeader({ ...(language === "EN" ? senderDefaults : {}), language, date: today(), customerCompany: "" });
    setItems([]);
    setEvents([]);
    setCanonical(null);
    setRejectNote("");
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

  async function save(e?: FormEvent): Promise<string | undefined> {
    e?.preventDefault();
    const payload = {
      ...header,
      customerCompany: language === "ZH" ? (header.customerCompany || "Chinese PI") : header.customerCompany,
      language,
      items
    };
    if (current) {
      await api.patch(`/pi/${current.id}`, payload);
      await open(current.id);
      await reload();
      return current.id;
    }
    const res = await api.post("/pi", payload);
    await open(res.data.id);
    await reload();
    return res.data.id as string;
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
      const diff = computePiDiff(canonical, snapshot());
      const payload = diff
        ? {
            pi: { ...header, customerCompany: header.customerCompany || "Chinese PI", language },
            items,
            diff
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
      const diff = computePiDiff(canonical, snapshot());
      await api.post(`/pi/${current.id}/reject`, {
        note: rejectNote.trim(),
        suggestedChanges: diff ?? undefined
      });
      clearState();
      await reload();
    } catch (err: any) {
      setExportError(err.response?.data?.error ?? err.message ?? "Reject failed.");
    } finally {
      setRejecting(false);
    }
  }

  async function deleteDraft(pi: Pi) {
    if (language === "ZH" && pi.status !== "DRAFT") return;
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
    exporting, confirming, rejecting, exportError,
    // Derived
    locked, canEditPendingZh, canConfirmReceivedZh, hasBufferedEdits, isDirty,
    total, totalCurrency,
    // Setters
    setHeader, setItems, setAssignedToId, setRejectNote, setExportError,
    // Actions
    reload, open, reset, clearState, selectPi, save, submit,
    confirmReceivedPi, rejectReview, deleteDraft, downloadExcel
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
