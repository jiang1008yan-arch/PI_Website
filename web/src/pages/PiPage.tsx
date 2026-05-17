import { useEffect, useMemo, useState } from "react";
import { Calendar, FileCheck2, FileText, Plus } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState, Field, PageHero, Section } from "../components/Form";
import type { Language, Pi, Product, ProductField, User } from "../types";
import { LineItem } from "../pi/LineItem";
import { OptionSetModal } from "../pi/OptionSetModal";
import { SelectWithManage } from "../pi/SelectWithManage";
import { formatCurrency } from "../pi/format";
import {
  labelForCustomer,
  labelForSender,
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
import { parseField } from "../products/productFields";
import { usePiEditor } from "../pi/usePiEditor";
import { parsePiItems } from "../pi/piItemCodec";

const today = new Date().toISOString().slice(0, 10);
type OptionKey = "customerSource" | "customerType" | "incoterm" | "shipmentMode";

export function PiPage({ language }: { language: Language }) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState<Product[]>([]);
  const [recipients, setRecipients] = useState<User[]>([]);
  const [sourceOptions, setSourceOptions] = useState<string[]>([]);
  const [typeOptions, setTypeOptions] = useState<string[]>([]);
  const [incotermOptions, setIncotermOptions] = useState<string[]>([]);
  const [shipmentOptions, setShipmentOptions] = useState<string[]>([]);
  const [senderDefaults, setSenderDefaults] = useState<Record<string, string>>({});
  const [optionEditor, setOptionEditor] = useState<OptionKey | null>(null);
  const title = language === "EN" ? "English PI" : "Chinese PI";
  const linkedPiId = searchParams.get("piId");

  const editor = usePiEditor({
    language,
    user,
    linkedPiId,
    senderDefaults,
    setSearchParams
  });

  // Submitted-snapshot view. After approve-with-edits the live PI row diverges
  // from what was originally submitted; the snapshot column lets the submitter
  // (and the admin, for traceability) toggle back to the original submission.
  const [snapshotView, setSnapshotView] = useState<"approved" | "submitted">("approved");
  const parsedSnapshot = useMemo(() => {
    const raw = editor.current?.submittedSnapshot;
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { header: Record<string, any>; items: any[] };
      return { header: parsed.header ?? {}, items: parsePiItems(parsed.items ?? []) };
    } catch {
      return null;
    }
  }, [editor.current?.submittedSnapshot]);
  const canViewSnapshot = Boolean(
    language === "ZH" && editor.current?.status === "APPROVED" && parsedSnapshot
  );
  useEffect(() => { setSnapshotView("approved"); }, [editor.current?.id]);
  const showingSnapshot = canViewSnapshot && snapshotView === "submitted";
  const viewHeader = showingSnapshot ? parsedSnapshot!.header : editor.header;
  const viewItems = showingSnapshot ? parsedSnapshot!.items : editor.items;

  const loadProducts = async () => {
    const res = await api.get("/products");
    setProducts(res.data.filter((x: Product) => x.status === "ACTIVE"));
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
    setSenderDefaults(senderDefaultsFrom(sender.data));
  };

  const loadZhSetup = async () => {
    if (language !== "ZH") return;
    const [users, sources, types] = await Promise.all([
      api.get("/review-recipients"),
      api.get("/options/customerSource"),
      api.get("/options/customerType")
    ]);
    setRecipients(users.data);
    editor.setAssignedToId(editor.assignedToId || users.data[0]?.id || "");
    setSourceOptions(sources.data.map((row: any) => row.value));
    setTypeOptions(types.data.map((row: any) => row.value));
  };

  useEffect(() => { loadProducts(); loadEnSetup(); loadZhSetup(); }, [language]);

  async function addProduct(productId: string) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    const res = await api.get(`/products/${product.id}/fields?language=${language}`);
    const rule = language === "ZH" ? await loadModelRule(product.id, language) : null;
    const fields: ProductField[] = res.data.map(parseField);
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
    editor.setItems([...editor.items, nextItem]);
  }

  async function saveOptionSet(key: OptionKey, values: string[]) {
    await api.put(`/options/${key}`, { values });
    setOptionEditor(null);
    await loadEnSetup();
    await loadZhSetup();
  }

  const setHeaderField = (patch: Record<string, any>) =>
    editor.setHeader({ ...editor.header, ...patch });

  function renderPiCard(p: Pi) {
    return (
      <div key={p.id} className="relative">
        <button className="choice-card w-full pr-16" onClick={() => editor.selectPi(p.id)}>
          {piDisplayName(p, language)}
          <br />
          <span className="text-xs text-slate-500">{piListSubtitle(p, language)}</span>
        </button>
        {(language === "EN" || p.status === "DRAFT") && (
          <button
            type="button"
            className="btn-danger absolute right-2 top-2 px-2 py-1 text-xs"
            onClick={() => editor.deleteDraft(p)}
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
        action={!linkedPiId ? <button className="btn-primary flex items-center gap-2" onClick={editor.reset} type="button"><Plus size={16} />New</button> : null}
      />

      {!linkedPiId && (
        <Section title={`${title} List`}>
          {editor.activePis.length === 0 ? (
            <EmptyState title="Start with a fresh PI" description="Create a draft, add products, then save or send it when the details feel complete." />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {editor.activePis.map(renderPiCard)}
            </div>
          )}
        </Section>
      )}

      <form onSubmit={editor.save} className="space-y-6">
        <Section title={editor.current ? piSectionTitle(editor.current, language) : `New ${title}`}>
          {editor.current?.rejectionNote && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{editor.current.rejectionNote}</div>}
          {editor.locked && editor.current && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">This PI is read-only in status {editor.current.status}.</div>}
          {editor.canEditPendingZh && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">You received this PI. Edits stay in your browser — nothing is saved until you Confirm. Reject sends the PI back with your note (and any edits become suggestions).</div>}
          {canViewSnapshot && (
            <div className="flex items-center gap-2 rounded-lg bg-[#f1f5fc] p-2 text-sm">
              <span className="text-[#63749b]">View:</span>
              <button
                type="button"
                className={snapshotView === "approved" ? "btn-primary px-3 py-1 text-xs" : "btn-secondary px-3 py-1 text-xs"}
                onClick={() => setSnapshotView("approved")}
              >
                Approved version
              </button>
              <button
                type="button"
                className={snapshotView === "submitted" ? "btn-primary px-3 py-1 text-xs" : "btn-secondary px-3 py-1 text-xs"}
                onClick={() => setSnapshotView("submitted")}
              >
                What I submitted
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {language === "EN" ? (
              <>
                <Field label="PI No."><input disabled={editor.locked} value={viewHeader.piNo ?? ""} onChange={(e) => setHeaderField({ piNo: e.target.value })} required /></Field>
                <DateField label="Date" disabled={editor.locked} value={viewHeader.date ?? today} onChange={(value) => setHeaderField({ date: value })} />
                <DateField label="Valid Until" disabled={editor.locked} value={viewHeader.validUntil ?? ""} onChange={(value) => setHeaderField({ validUntil: value })} />
                <SelectWithManage label="Incoterm" value={viewHeader.incoterm ?? ""} options={incotermOptions} disabled={editor.locked} canManage={user?.role === "ADMIN"} onChange={(value) => setHeaderField({ incoterm: value })} onManage={() => setOptionEditor("incoterm")} />
                <SelectWithManage label="Shipment Mode" value={viewHeader.shipmentMode ?? ""} options={shipmentOptions} disabled={editor.locked} canManage={user?.role === "ADMIN"} onChange={(value) => setHeaderField({ shipmentMode: value })} onManage={() => setOptionEditor("shipmentMode")} />
                <Field label="Payment Term"><input disabled={editor.locked} value={viewHeader.paymentTerm ?? ""} onChange={(e) => setHeaderField({ paymentTerm: e.target.value })} /></Field>
              </>
            ) : (
              <>
                <Field label="Production Order No."><input disabled={editor.locked} value={viewHeader.productionOrderNo ?? ""} onChange={(e) => setHeaderField({ productionOrderNo: e.target.value })} /></Field>
                <SelectWithManage label="Customer Source" value={viewHeader.customerSource ?? ""} options={sourceOptions} disabled={editor.locked} canManage={user?.role === "ADMIN"} onChange={(value) => setHeaderField({ customerSource: value })} onManage={() => setOptionEditor("customerSource")} />
                <SelectWithManage label="Customer Type" value={viewHeader.customerType ?? ""} options={typeOptions} disabled={editor.locked} canManage={user?.role === "ADMIN"} onChange={(value) => setHeaderField({ customerType: value })} onManage={() => setOptionEditor("customerType")} />
                <DateField label="Delivery Date" disabled={editor.locked} value={viewHeader.deliveryDate ?? ""} onChange={(value) => setHeaderField({ deliveryDate: value })} />
              </>
            )}
          </div>
        </Section>

        {language === "EN" && (
          <Section title="Sender Information">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {["senderCorp", "senderAddress", "senderFrom", "senderPhone", "senderEmail"].map((k) => (
                <Field key={k} label={labelForSender(k)}>
                  <input disabled={editor.locked} value={viewHeader[k] ?? ""} onChange={(e) => setHeaderField({ [k]: e.target.value })} />
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
                  <input disabled={editor.locked} value={viewHeader[k] ?? ""} onChange={(e) => setHeaderField({ [k]: e.target.value })} required={k === "customerCompany"} />
                </Field>
              ))}
            </div>
          </Section>
        )}

        <Section
          title="Products / Line Items"
          action={!editor.locked && (
            <select onChange={(e) => { addProduct(e.target.value); e.currentTarget.value = ""; }} defaultValue="">
              <option value="" disabled>Add Product</option>
              {products.map((p) => <option key={p.id} value={p.id}>{productOptionLabel(p, language)}</option>)}
            </select>
          )}
        >
          <div className="space-y-3">
            {viewItems.length === 0 && !editor.locked && <EmptyState title="Add the first product" description="Pick a product above and the page will open the fields needed for this invoice." />}
            {viewItems.map((it, idx) => (
              <LineItem
                key={idx}
                item={it}
                product={products.find((p) => p.id === it.productId)}
                language={language}
                locked={editor.locked || showingSnapshot}
                onChange={(next) => editor.setItems(editor.items.map((x, i) => i === idx ? next : x))}
                onRemove={() => editor.setItems(editor.items.filter((_, i) => i !== idx))}
              />
            ))}
          </div>
          {language === "EN" && <div className="text-right font-semibold">Total: {formatCurrency(editor.total, editor.totalCurrency)}</div>}
        </Section>

        <Section title="Other Requirements">
          <textarea
            className="w-full"
            disabled={editor.locked}
            rows={5}
            value={viewHeader.otherRequirements ?? ""}
            onChange={(e) => setHeaderField({ otherRequirements: e.target.value })}
          />
        </Section>

        {editor.events.length > 0 && (
          <Section title="Review History">
            {editor.events.map((e) => <div key={e.id} className="border-t py-2 text-sm">{e.action} by {e.actorName} - {e.note}</div>)}
          </Section>
        )}

        {editor.canConfirmReceivedZh && (
          <Section title="Reject this PI">
            <textarea
              className="w-full"
              rows={3}
              placeholder="Reason the submitter needs (required to reject)"
              value={editor.rejectNote}
              onChange={(e) => editor.setRejectNote(e.target.value)}
            />
          </Section>
        )}

        <div className="flex flex-wrap items-end gap-2">
          {language === "ZH" && !editor.locked && !editor.canConfirmReceivedZh && (
            <Field label="Send to">
              <select value={editor.assignedToId} onChange={(e) => editor.setAssignedToId(e.target.value)}>
                {recipients.map((recipient) => <option key={recipient.id} value={recipient.id}>{recipient.displayName}</option>)}
              </select>
            </Field>
          )}
          {!editor.locked && !editor.canConfirmReceivedZh && <button className="btn-primary">{language === "EN" ? "Save" : "Save Draft"}</button>}
          {language === "ZH" && !editor.locked && !editor.canConfirmReceivedZh && <button type="button" className="btn-secondary" onClick={editor.submit}>Send to Recipient</button>}
          {editor.canConfirmReceivedZh && (
            <>
              <button type="button" className="btn-primary" disabled={editor.confirming || editor.rejecting} onClick={editor.confirmReceivedPi}>
                {editor.confirming ? "Confirming..." : "Confirm"}
              </button>
              <button type="button" className="btn-danger" disabled={editor.confirming || editor.rejecting} onClick={editor.rejectReview}>
                {editor.rejecting ? "Rejecting..." : "Reject"}
              </button>
            </>
          )}
          {editor.current && (language === "EN" || (language === "ZH" && user?.role === "ADMIN" && editor.current.status === "APPROVED")) && (
            <button type="button" className="btn-secondary" disabled={editor.exporting} onClick={editor.downloadExcel}>
              {editor.exporting ? "Generating..." : "Download Excel"}
            </button>
          )}
        </div>
        {editor.exportError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{editor.exportError}</div>}
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
