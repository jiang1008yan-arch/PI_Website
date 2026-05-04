import { FormEvent, useEffect, useMemo, useState } from "react";
import { Calendar, FileCheck2, FileText, Plus } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState, Field, PageHero, Section } from "../components/Form";
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
        <button className="choice-card w-full pr-16" onClick={() => selectPi(p.id)}>
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
      <PageHero
        eyebrow="PI workspace"
        title={title}
        description={language === "EN" ? "Create a clear English proforma invoice with customer, sender and product details in one guided flow." : "Fill the Chinese PI draft, send it for review, and keep approved work ready for Excel export."}
        Icon={language === "EN" ? FileText : FileCheck2}
        action={!linkedPiId ? <button className="btn-primary flex items-center gap-2" onClick={reset} type="button"><Plus size={16} />New</button> : null}
      />

      {!linkedPiId && (
        <Section title={`${title} List`}>
          {activePis.length === 0 ? (
            <EmptyState title="Start with a fresh PI" description="Create a draft, add products, then save or send it when the details feel complete." />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {activePis.map(renderPiCard)}
            </div>
          )}
        </Section>
      )}

      <form onSubmit={save} className="space-y-6">
        <Section title={current ? piSectionTitle(current, language) : `New ${title}`}>
          {current?.rejectionNote && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{current.rejectionNote}</div>}
          {locked && current && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">This PI is read-only in status {current.status}.</div>}
          {canEditPendingZh && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">You received this PI. Edit it, then confirm to save it for Excel download.</div>}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {language === "EN" ? (
              <>
                <Field label="PI No."><input disabled={locked} value={header.piNo ?? ""} onChange={(e) => setHeader({ ...header, piNo: e.target.value })} required /></Field>
                <DateField label="Date" disabled={locked} value={header.date ?? today} onChange={(value) => setHeader({ ...header, date: value })} />
                <DateField label="Valid Until" disabled={locked} value={header.validUntil ?? ""} onChange={(value) => setHeader({ ...header, validUntil: value })} />
                <SelectWithManage label="Incoterm" value={header.incoterm ?? ""} options={incotermOptions} disabled={locked} canManage={user?.role === "ADMIN"} onChange={(value) => setHeader({ ...header, incoterm: value })} onManage={() => setOptionEditor("incoterm")} />
                <SelectWithManage label="Shipment Mode" value={header.shipmentMode ?? ""} options={shipmentOptions} disabled={locked} canManage={user?.role === "ADMIN"} onChange={(value) => setHeader({ ...header, shipmentMode: value })} onManage={() => setOptionEditor("shipmentMode")} />
                <Field label="Payment Term"><input disabled={locked} value={header.paymentTerm ?? ""} onChange={(e) => setHeader({ ...header, paymentTerm: e.target.value })} /></Field>
              </>
            ) : (
              <>
                <Field label="Production Order No."><input disabled={locked} value={header.productionOrderNo ?? ""} onChange={(e) => setHeader({ ...header, productionOrderNo: e.target.value })} /></Field>
                <SelectWithManage label="Customer Source" value={header.customerSource ?? ""} options={sourceOptions} disabled={locked} canManage={user?.role === "ADMIN"} onChange={(value) => setHeader({ ...header, customerSource: value })} onManage={() => setOptionEditor("customerSource")} />
                <SelectWithManage label="Customer Type" value={header.customerType ?? ""} options={typeOptions} disabled={locked} canManage={user?.role === "ADMIN"} onChange={(value) => setHeader({ ...header, customerType: value })} onManage={() => setOptionEditor("customerType")} />
                <DateField label="Delivery Date" disabled={locked} value={header.deliveryDate ?? ""} onChange={(value) => setHeader({ ...header, deliveryDate: value })} />
              </>
            )}
          </div>
        </Section>

        {language === "EN" && (
          <Section title="Sender Information">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
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
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
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
            {items.length === 0 && !locked && <EmptyState title="Add the first product" description="Pick a product above and the page will open the fields needed for this invoice." />}
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

function DateField({ label, disabled, value, onChange }: { label: string; disabled: boolean; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={label}>
      <span className="relative block">
        <input
          readOnly
          disabled={disabled}
          value={value}
          placeholder="YYYY-MM-DD"
          className="w-full pr-10"
        />
        <input
          aria-label={label}
          type="date"
          disabled={disabled}
          value={value}
          lang="en-US"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          onChange={(e) => onChange(e.target.value)}
        />
        <Calendar size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#294477]" />
      </span>
    </Field>
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
