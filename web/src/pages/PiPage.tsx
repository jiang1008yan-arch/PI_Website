import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Field, Section } from "../components/Form";
import type { Language, Pi, PiItem, Product, ProductField, User } from "../types";
import { exportPi } from "../excel/exportPi";
import { LineItem } from "../pi/LineItem";
import { OptionSetModal } from "../pi/OptionSetModal";
import { SelectWithManage } from "../pi/SelectWithManage";
import { getMeta } from "../pi/fieldValues";
import { formatCurrency } from "../pi/format";
import {
  labelForCustomer,
  labelForSender,
  isConfirmedReceivedPi,
  piDisplayName,
  productOptionLabel,
  senderDefaultsFrom
} from "../pi/labels";
import {
  applyModelRule,
  modelRuleSeedFields,
  ModelRule,
  modelRuleKey,
  normalizeRule,
  optionPath
} from "../pi/modelRule";

const today = new Date().toISOString().slice(0, 10);
const EXCEL_DOWNLOAD_TIMEOUT_MS = 45000;
type OptionKey = "customerSource" | "customerType" | "incoterm" | "shipmentMode";

export function PiPage({ language }: { language: Language }) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState<Product[]>([]);
  const [pis, setPis] = useState<Pi[]>([]);
  const [current, setCurrent] = useState<Pi | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [items, setItems] = useState<PiItem[]>([]);
  const [header, setHeader] = useState<any>({ language, date: today, customerCompany: "" });
  const [recipients, setRecipients] = useState<User[]>([]);
  const [assignedToId, setAssignedToId] = useState("");
  const [sourceOptions, setSourceOptions] = useState<string[]>([]);
  const [typeOptions, setTypeOptions] = useState<string[]>([]);
  const [incotermOptions, setIncotermOptions] = useState<string[]>([]);
  const [shipmentOptions, setShipmentOptions] = useState<string[]>([]);
  const [senderDefaults, setSenderDefaults] = useState<Record<string, string>>({});
  const [optionEditor, setOptionEditor] = useState<OptionKey | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [exportError, setExportError] = useState("");
  const canEditPendingZh = language === "ZH" && current?.status === "PENDING_REVIEW" && user?.role === "ADMIN";
  const canConfirmReceivedZh = canEditPendingZh;
  const locked = Boolean(language === "ZH" && current && !["DRAFT", "REJECTED"].includes(current.status) && !canEditPendingZh);
  const title = language === "EN" ? "English PI" : "Chinese PI";
  const linkedPiId = searchParams.get("piId");
  const activePis = language === "ZH"
    ? pis.filter((p) => p.status !== "APPROVED" && !isConfirmedReceivedPi(p, user?.id))
    : pis;

  const load = async () => {
    const [p, list] = await Promise.all([api.get("/products"), api.get("/pi")]);
    setProducts(p.data.filter((x: Product) => x.status === "ACTIVE"));
    setPis(list.data.filter((x: Pi) => x.language === language));
  };

  const loadEnSetup = async () => {
    if (language !== "EN") return;
    const [incoterms, shipments, sender] = await Promise.all([
      api.get("/options/incoterm"),
      api.get("/options/shipmentMode"),
      api.get("/sender-profile")
    ]);
    setIncotermOptions(incoterms.data.map((row: any) => row.value));
    setShipmentOptions(shipments.data.map((row: any) => row.value));
    const defaults = senderDefaultsFrom(sender.data);
    setSenderDefaults(defaults);
    setHeader((prev: any) => prev.language === "EN" ? { ...defaults, ...prev } : prev);
  };

  const loadZhSetup = async () => {
    if (language !== "ZH") return;
    const [users, sources, types] = await Promise.all([
      api.get("/review-recipients"),
      api.get("/options/customerSource"),
      api.get("/options/customerType")
    ]);
    setRecipients(users.data);
    setAssignedToId((currentValue) => currentValue || users.data[0]?.id || "");
    setSourceOptions(sources.data.map((row: any) => row.value));
    setTypeOptions(types.data.map((row: any) => row.value));
  };

  useEffect(() => { load(); loadEnSetup(); loadZhSetup(); }, [language]);
  useEffect(() => {
    if (language === "ZH" && linkedPiId) void open(linkedPiId);
  }, [language, linkedPiId]);

  const total = useMemo(
    () => items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.unitPrice) * (1 - Number(it.discountPct) / 100), 0),
    [items]
  );
  const totalCurrency = getMeta(items[0], "currency") || "USD";

  async function open(id: string) {
    const res = await api.get(`/pi/${id}`);
    setCurrent(res.data.pi);
    setHeader(res.data.pi);
    setAssignedToId(res.data.pi.assignedToId ?? assignedToId);
    const parsedItems = res.data.items.map((x: any) => ({ ...x, fieldValues: JSON.parse(x.fieldValues || "[]") }));
    setItems(await hydrateFieldOptions(parsedItems));
    setEvents(res.data.events ?? []);
  }

  function reset() {
    if (language === "ZH") setSearchParams({});
    setCurrent(null);
    setHeader({ ...(language === "EN" ? senderDefaults : {}), language, date: today, customerCompany: "" });
    setItems([]);
    setEvents([]);
  }

  function selectPi(id: string) {
    if (language === "ZH") setSearchParams({ piId: id });
    void open(id);
  }

  async function save(e?: FormEvent) {
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
      await load();
      return current.id;
    }
    const res = await api.post("/pi", payload);
    await open(res.data.id);
    await load();
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
    await load();
  }

  async function confirmReceivedPi() {
    if (!current) return;
    setExportError("");
    setConfirming(true);
    try {
      const id = await save();
      if (!id) return;
      await api.post(`/pi/${id}/approve`);
      await open(id);
      await load();
    } catch (err: any) {
      setExportError(err.response?.data?.error ?? err.message ?? "Confirm failed.");
    } finally {
      setConfirming(false);
    }
  }

  async function deleteDraft(pi: Pi) {
    if (language === "ZH" && pi.status !== "DRAFT") return;
    const ok = window.confirm(`Delete ${language === "EN" ? "PI" : "draft"} ${piDisplayName(pi, language)}?`);
    if (!ok) return;
    await api.delete(`/pi/${pi.id}`);
    if (current?.id === pi.id) reset();
    await load();
  }

  async function downloadExcel() {
    if (!current) return;
    setExportError("");
    setExporting(true);
    try {
      await withTimeout(async () => {
        const id = locked ? current.id : await save();
        if (id) await exportPi(id);
      }, EXCEL_DOWNLOAD_TIMEOUT_MS);
    } catch (err: any) {
      setExportError(err.response?.data?.error ?? err.message ?? "Excel download failed.");
    } finally {
      setExporting(false);
    }
  }

  async function addProduct(productId: string) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    const res = await api.get(`/products/${product.id}/fields?language=${language}`);
    const rule = language === "ZH" ? await loadModelRule(product.id, language) : null;
    const fields: ProductField[] = res.data.map((f: any) => ({ ...f, options: JSON.parse(f.options || "[]") }));
    const meta = language === "EN" ? [{ label: "__currency", value: "USD", fieldType: "TEXT", sortOrder: -1 }] : [];
    const ruleFields = rule?.enabled ? modelRuleSeedFields(rule, language) : [];
    const nextItem = applyModelRule({
      productId,
      quantity: 1,
      unitPrice: 0,
      discountPct: 0,
      fieldValues: [
        ...meta,
        ...ruleFields,
        ...fields.map((f) => ({
          label: f.label,
          value: f.defaultValue ?? "",
          fieldType: f.fieldType,
          options: f.options ?? [],
          sortOrder: f.sortOrder
        }))
      ]
    }, language);
    setItems([...items, nextItem]);
  }

  async function hydrateFieldOptions(itemsToHydrate: PiItem[]) {
    return Promise.all(itemsToHydrate.map(async (item) => {
      try {
        const res = await api.get(`/products/${item.productId}/fields?language=${language}`);
        const optionsByLabel = new Map<string, string[]>(
          res.data.map((field: any) => [String(field.label), JSON.parse(field.options || "[]")])
        );
        const typeByLabel = new Map<string, string>(
          res.data.map((field: any) => [String(field.label), String(field.fieldType)])
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

  async function saveOptionSet(key: OptionKey, values: string[]) {
    await api.put(`/options/${key}`, { values });
    setOptionEditor(null);
    await loadEnSetup();
    await loadZhSetup();
  }

  function renderPiCard(p: Pi) {
    return (
      <div key={p.id} className="relative">
        <button className="btn-secondary w-full pr-16 text-left" onClick={() => selectPi(p.id)}>
          {piDisplayName(p, language)}
          <br />
          <span className="text-xs text-slate-500">{piListSubtitle(p, language)}</span>
        </button>
        {(language === "EN" || p.status === "DRAFT") && (
          <button
            type="button"
            className="btn-danger absolute right-2 top-2 px-2 py-1 text-xs"
            onClick={() => deleteDraft(p)}
          >
            Delete
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!linkedPiId && (
        <Section title={`${title} List`} action={<button className="btn-secondary" onClick={reset}>New</button>}>
          <div className="grid grid-cols-3 gap-3">
            {activePis.map(renderPiCard)}
          </div>
        </Section>
      )}

      <form onSubmit={save} className="space-y-6">
        <Section title={current ? piSectionTitle(current, language) : `New ${title}`}>
          {current?.rejectionNote && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{current.rejectionNote}</div>}
          {locked && current && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">This PI is read-only in status {current.status}.</div>}
          {canEditPendingZh && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">You received this PI. Edit it, then confirm to save it for Excel download.</div>}

          <div className="grid grid-cols-2 gap-3">
            {language === "EN" ? (
              <>
                <Field label="PI No."><input disabled={locked} value={header.piNo ?? ""} onChange={(e) => setHeader({ ...header, piNo: e.target.value })} required /></Field>
                <Field label="Date"><input disabled={locked} value={header.date ?? today} placeholder="YYYY-MM-DD" onChange={(e) => setHeader({ ...header, date: e.target.value })} /></Field>
                <Field label="Valid Until"><input disabled={locked} value={header.validUntil ?? ""} placeholder="YYYY-MM-DD" onChange={(e) => setHeader({ ...header, validUntil: e.target.value })} /></Field>
                <SelectWithManage label="Incoterm" value={header.incoterm ?? ""} options={incotermOptions} disabled={locked} canManage={user?.role === "ADMIN"} onChange={(value) => setHeader({ ...header, incoterm: value })} onManage={() => setOptionEditor("incoterm")} />
                <SelectWithManage label="Shipment Mode" value={header.shipmentMode ?? ""} options={shipmentOptions} disabled={locked} canManage={user?.role === "ADMIN"} onChange={(value) => setHeader({ ...header, shipmentMode: value })} onManage={() => setOptionEditor("shipmentMode")} />
                <Field label="Payment Term"><input disabled={locked} value={header.paymentTerm ?? ""} onChange={(e) => setHeader({ ...header, paymentTerm: e.target.value })} /></Field>
              </>
            ) : (
              <>
                <Field label="Production Order No."><input disabled={locked} value={header.productionOrderNo ?? ""} onChange={(e) => setHeader({ ...header, productionOrderNo: e.target.value })} /></Field>
                <SelectWithManage label="Customer Source" value={header.customerSource ?? ""} options={sourceOptions} disabled={locked} canManage={user?.role === "ADMIN"} onChange={(value) => setHeader({ ...header, customerSource: value })} onManage={() => setOptionEditor("customerSource")} />
                <SelectWithManage label="Customer Type" value={header.customerType ?? ""} options={typeOptions} disabled={locked} canManage={user?.role === "ADMIN"} onChange={(value) => setHeader({ ...header, customerType: value })} onManage={() => setOptionEditor("customerType")} />
                <Field label="Delivery Date"><input disabled={locked} value={header.deliveryDate ?? ""} placeholder="YYYY-MM-DD" onChange={(e) => setHeader({ ...header, deliveryDate: e.target.value })} /></Field>
              </>
            )}
          </div>
        </Section>

        {language === "EN" && (
          <Section title="Sender Information">
            <div className="grid grid-cols-3 gap-3">
              {["senderCorp", "senderAddress", "senderFrom", "senderPhone", "senderEmail"].map((k) => (
                <Field key={k} label={labelForSender(k)}>
                  <input disabled={locked} value={header[k] ?? ""} onChange={(e) => setHeader({ ...header, [k]: e.target.value })} />
                </Field>
              ))}
            </div>
          </Section>
        )}

        {language === "EN" && (
          <Section title="Customer Information">
            <div className="grid grid-cols-3 gap-3">
              {["customerCompany", "customerContact", "customerEmail", "customerPhone", "customerAddress"].map((k) => (
                <Field key={k} label={labelForCustomer(k)}>
                  <input disabled={locked} value={header[k] ?? ""} onChange={(e) => setHeader({ ...header, [k]: e.target.value })} required={k === "customerCompany"} />
                </Field>
              ))}
            </div>
          </Section>
        )}

        <Section
          title="Products / Line Items"
          action={!locked && (
            <select onChange={(e) => { addProduct(e.target.value); e.currentTarget.value = ""; }} defaultValue="">
              <option value="" disabled>Add Product</option>
              {products.map((p) => <option key={p.id} value={p.id}>{productOptionLabel(p, language)}</option>)}
            </select>
          )}
        >
          <div className="space-y-3">
            {items.map((it, idx) => (
              <LineItem
                key={idx}
                item={it}
                product={products.find((p) => p.id === it.productId)}
                language={language}
                locked={locked}
                onChange={(next) => setItems(items.map((x, i) => i === idx ? next : x))}
                onRemove={() => setItems(items.filter((_, i) => i !== idx))}
              />
            ))}
          </div>
          {language === "EN" && <div className="text-right font-semibold">Total: {formatCurrency(total, totalCurrency)}</div>}
        </Section>

        <Section title="Other Requirements">
          <textarea
            className="w-full"
            disabled={locked}
            rows={5}
            value={header.otherRequirements ?? ""}
            onChange={(e) => setHeader({ ...header, otherRequirements: e.target.value })}
          />
        </Section>

        {events.length > 0 && (
          <Section title="Review History">
            {events.map((e) => <div key={e.id} className="border-t py-2 text-sm">{e.action} by {e.actorName} - {e.note}</div>)}
          </Section>
        )}

        <div className="flex flex-wrap items-end gap-2">
          {language === "ZH" && !locked && !canConfirmReceivedZh && (
            <Field label="Send to">
              <select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)}>
                {recipients.map((recipient) => <option key={recipient.id} value={recipient.id}>{recipient.displayName}</option>)}
              </select>
            </Field>
          )}
          {!locked && !canConfirmReceivedZh && <button className="btn-primary">{language === "EN" ? "Save" : "Save Draft"}</button>}
          {language === "ZH" && !locked && !canConfirmReceivedZh && <button type="button" className="btn-secondary" onClick={submit}>Send to Recipient</button>}
          {canConfirmReceivedZh && (
            <button type="button" className="btn-primary" disabled={confirming} onClick={confirmReceivedPi}>
              {confirming ? "Confirming..." : "Confirm"}
            </button>
          )}
          {current && (language === "EN" || (language === "ZH" && user?.role === "ADMIN" && current.status === "APPROVED")) && (
            <button type="button" className="btn-secondary" disabled={exporting} onClick={downloadExcel}>
              {exporting ? "Generating..." : "Download Excel"}
            </button>
          )}
        </div>
        {exportError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{exportError}</div>}
      </form>

      {optionEditor && (
        <OptionSetModal
          title={optionTitle(optionEditor)}
          options={optionsFor(optionEditor, { sourceOptions, typeOptions, incotermOptions, shipmentOptions })}
          onClose={() => setOptionEditor(null)}
          onSave={(values) => saveOptionSet(optionEditor, values)}
        />
      )}
    </div>
  );
}

function optionTitle(key: OptionKey) {
  return ({
    customerSource: "Customer Source Options",
    customerType: "Customer Type Options",
    incoterm: "Incoterm Options",
    shipmentMode: "Shipment Mode Options"
  })[key];
}

function optionsFor(
  key: OptionKey,
  state: { sourceOptions: string[]; typeOptions: string[]; incotermOptions: string[]; shipmentOptions: string[] }
) {
  return ({
    customerSource: state.sourceOptions,
    customerType: state.typeOptions,
    incoterm: state.incotermOptions,
    shipmentMode: state.shipmentOptions
  })[key];
}

function piListSubtitle(pi: Pi, language: Language) {
  if (language === "EN") return pi.customerCompany || "";
  return `${pi.customerCompany} - ${pi.status}`;
}

function piSectionTitle(pi: Pi, language: Language) {
  if (language === "EN") return piDisplayName(pi, language);
  return `${piDisplayName(pi, language)} - ${pi.status}`;
}

async function loadModelRule(productId: string, language: Language): Promise<ModelRule | null> {
  const res = await api.get(optionPath(modelRuleKey(productId, language)));
  const raw = res.data[0]?.value;
  if (!raw) return null;
  try {
    const rule = normalizeRule(JSON.parse(raw));
    return rule.enabled ? rule : null;
  } catch {
    return null;
  }
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
