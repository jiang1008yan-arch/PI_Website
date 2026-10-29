import { useEffect, useMemo, useState } from "react";
import { markSeen } from "../pi/notifications";
import { Calendar, ChevronLeft, FileCheck2, FileText, Plus } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState, ErrorText, Field, PageHero, Section } from "../components/Form";
import { useConfirm } from "../components/ConfirmDialog";
import type { Language, Pi, PiReviewEvent, Product, ProductField, User } from "../types";
import { LineItem } from "../pi/LineItem";
import { OptionSetModal } from "../pi/OptionSetModal";
import { SelectWithManage } from "../pi/SelectWithManage";
import { formatCurrency } from "../pi/format";
import {
  labelForCustomer,
  labelForSender,
  piDisplayName,
  piStatusLabel,
  productOptionLabel,
  reviewEventLabel,
  revisionLabel,
  senderDefaultsFrom
} from "../pi/labels";
import { revisionChanges } from "../pi/piDiff";
import {
  applyModelRule,
  modelRuleSeedFields,
  ModelRule,
  modelRuleKey,
  normalizeRule,
  optionPath
} from "../../../shared/modelRule";
import { parseField } from "../products/productFields";
import { DISCARD_PROMPT, usePiEditor } from "../pi/usePiEditor";
import { parsePiItems } from "../../../shared/piItemCodec";
import { setMetaValue } from "../../../shared/lineItemFields";
import { shouldShowLinkedZhSyncButton } from "../pi/linkedZhSync";

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

  // The list and the editor are separate views of the same workspace: the page
  // opens on the list and only swaps to the editor when you create or open a PI.
  const [editing, setEditing] = useState(false);
  // Opening a PI here counts as seeing it for the home badges (review queue,
  // commerce queue, confirmed received), not only opening those pages.
  const openedId = editor.current?.id;
  useEffect(() => {
    if (openedId) markSeen(["pendingReviews", "pendingCommerce", "confirmedReceived"], user?.id, [openedId]);
  }, [openedId, user?.id]);
  const inEditor = editing || Boolean(editor.current) || Boolean(linkedPiId);
  useEffect(() => { setEditing(false); }, [language]);
  const confirm = useConfirm();
  function startNew() {
    void editor.reset();
    setEditing(true);
  }
  function openPi(id: string) {
    void editor.selectPi(id);
    setEditing(true);
  }
  async function backToList() {
    if (editor.isDirty && !(await confirm(DISCARD_PROMPT))) return;
    editor.clearState();
    setEditing(false);
  }

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

  // While a revision is in progress, highlight what differs from the effective
  // (approved) Chinese version frozen on the PI.
  const revising = Boolean(language === "ZH" && editor.current?.revisionInProgress);
  const effectiveZh = useMemo(() => {
    if (!revising || !editor.current?.effectiveSnapshot) return null;
    try {
      const parsed = JSON.parse(editor.current.effectiveSnapshot);
      // The codec reads the frozen items' fieldValues (arrays) like stored ones.
      return parsed?.zh ? { header: parsed.zh.header ?? {}, items: parsePiItems(parsed.zh.items ?? []) } : null;
    } catch {
      return null;
    }
  }, [revising, editor.current?.effectiveSnapshot]);
  const changes = useMemo(
    () => revisionChanges(effectiveZh, { header: viewHeader, items: viewItems }),
    [effectiveZh, viewHeader, viewItems]
  );
  const canStartRevision = Boolean(
    language === "ZH" &&
      editor.current?.status === "APPROVED" &&
      !editor.current.revisionInProgress &&
      (user?.role === "ADMIN" || editor.current.createdById === user?.id)
  );
  const canAbandonRevision = Boolean(
    revising &&
      (editor.current?.status === "DRAFT" || editor.current?.status === "REJECTED") &&
      (user?.role === "ADMIN" || editor.current?.createdById === user?.id)
  );
  const [revisionReason, setRevisionReason] = useState("");
  const [revisionFormOpen, setRevisionFormOpen] = useState(false);
  useEffect(() => { setRevisionFormOpen(false); setRevisionReason(""); }, [editor.current?.id]);
  async function submitRevision() {
    if (!revisionReason.trim()) {
      editor.setExportError("Please give a reason for the change.");
      return;
    }
    if (await editor.startRevision(revisionReason.trim())) setRevisionFormOpen(false);
  }

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
    // Default the presales pick to the first Presales user (else an admin).
    const presalesFirst = [...users.data].sort((a: User, b: User) => Number(b.role === "PRESALES") - Number(a.role === "PRESALES"));
    editor.setAssignedToId(editor.assignedToId || presalesFirst.find((u: User) => u.role !== "COMMERCE")?.id || "");
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
    const meta = language === "EN" ? setMetaValue([], "currency", "USD") : [];
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
        <button className="choice-card w-full pr-16" onClick={() => openPi(p.id)}>
          {piDisplayName(p, language)}
          {Boolean(p.revisionInProgress) && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">Revision</span>}
          <br />
          <span className="text-xs text-slate-500">{piListSubtitle(p, language)}</span>
        </button>
        {(language === "EN" || (p.status === "DRAFT" && !p.revisionInProgress)) && (
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

  // Keep drafts in one consistent place at the top, then everything else.
  function renderPiGroup(label: string, list: Pi[]) {
    if (list.length === 0) return null;
    return (
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#8595b6]">
          {label} <span className="text-[#a9b6d4]">({list.length})</span>
        </h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{list.map(renderPiCard)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="PI workspace"
        title={title}
        Icon={language === "EN" ? FileText : FileCheck2}
        action={
          inEditor && !linkedPiId ? (
            <button className="btn-secondary flex items-center gap-2" onClick={backToList} type="button">
              <ChevronLeft size={16} />
              Back to list
            </button>
          ) : !inEditor ? (
            <button className="btn-primary flex items-center gap-2" onClick={startNew} type="button">
              <Plus size={16} />
              New
            </button>
          ) : null
        }
      />

      {!inEditor && (
        <Section title={`${title} List`}>
          {editor.listError && <div className="mb-4"><ErrorText message={editor.listError} /></div>}
          {editor.activePis.length === 0 && editor.listLoading ? (
            <PiListSkeleton />
          ) : editor.activePis.length === 0 ? (
            <EmptyState
              title="Start with a fresh PI"
              description={language === "ZH" ? "Approved Chinese PIs are listed under Confirmed Received PIs." : "Create a draft, add products, then save or send it when the details feel complete."}
            />
          ) : (
            <div className="space-y-6">
              {renderPiGroup("Drafts", editor.activePis.filter((p) => p.status === "DRAFT"))}
              {language === "EN" ? (
                renderPiGroup("Submitted", editor.activePis.filter((p) => p.status !== "DRAFT"))
              ) : (
                <>
                  {renderPiGroup("Rejected", editor.activePis.filter((p) => p.status === "REJECTED"))}
                  {renderPiGroup(piStatusLabel("PENDING_REVIEW"), editor.activePis.filter((p) => p.status === "PENDING_REVIEW"))}
                  {renderPiGroup(piStatusLabel("PENDING_COMMERCE"), editor.activePis.filter((p) => p.status === "PENDING_COMMERCE"))}
                </>
              )}
            </div>
          )}
        </Section>
      )}

      {inEditor && (
      <form onSubmit={editor.save} className="space-y-6">
        <PiEditorSection title={editor.current ? piSectionTitle(editor.current, language) : `New ${title}`}>
          {editor.current?.rejectionNote && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{editor.current.rejectionNote}</div>}
          {editor.locked && editor.current && (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
              {language === "EN" && editor.current.linkedPiStatus === "APPROVED"
                ? "This PI is locked because its Chinese PI is approved. Start a revision of the Chinese PI to change it."
                : `This PI is read-only (${piStatusLabel(editor.current.status, language)}).`}
            </div>
          )}
          {revising && editor.current && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              <span>
                <strong>{revisionLabel((editor.current.revisionNo ?? 1) + 1)} in progress.</strong> Reason: {editor.current.revisionReason || "—"}.
                {" "}The approved {revisionLabel(editor.current.revisionNo)} stays effective until commerce approves this revision. Highlighted fields differ from it.
              </span>
              {canAbandonRevision && (
                <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={editor.abandonRevision}>Abandon revision</button>
              )}
            </div>
          )}
          {language === "ZH" && editor.current && (editor.current.status === "PENDING_COMMERCE" || editor.current.status === "APPROVED" || revising) && (
            <div className="text-sm">
              <Link className="text-primary underline" to={`/pi/view/${editor.current.id}`}>Open the read-only view (Chinese and English)</Link>
            </div>
          )}
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
                <Changed on={changes.header.has("productionOrderNo")}><Field label="Production Order No."><input disabled={editor.locked} value={viewHeader.productionOrderNo ?? ""} onChange={(e) => setHeaderField({ productionOrderNo: e.target.value })} /></Field></Changed>
                <Changed on={changes.header.has("customerSource")}><SelectWithManage label="Customer Source" value={viewHeader.customerSource ?? ""} options={sourceOptions} disabled={editor.locked} canManage={user?.role === "ADMIN"} onChange={(value) => setHeaderField({ customerSource: value })} onManage={() => setOptionEditor("customerSource")} /></Changed>
                <Changed on={changes.header.has("customerType")}><SelectWithManage label="Customer Type" value={viewHeader.customerType ?? ""} options={typeOptions} disabled={editor.locked} canManage={user?.role === "ADMIN"} onChange={(value) => setHeaderField({ customerType: value })} onManage={() => setOptionEditor("customerType")} /></Changed>
                <Changed on={changes.header.has("deliveryDate")}><DateField label="Delivery Date" disabled={editor.locked} value={viewHeader.deliveryDate ?? ""} onChange={(value) => setHeaderField({ deliveryDate: value })} /></Changed>
              </>
            )}
          </div>
        </PiEditorSection>

        {language === "EN" && (
          <PiEditorSection title="Sender Information">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {["senderCorp", "senderAddress", "senderFrom", "senderPhone", "senderEmail"].map((k) => (
                <Field key={k} label={labelForSender(k)}>
                  <input disabled={editor.locked} value={viewHeader[k] ?? ""} onChange={(e) => setHeaderField({ [k]: e.target.value })} />
                </Field>
              ))}
            </div>
          </PiEditorSection>
        )}

        {language === "EN" && (
          <PiEditorSection title="Customer Information">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {["customerCompany", "customerContact", "customerEmail", "customerPhone", "customerAddress"].map((k) => (
                <Field key={k} label={labelForCustomer(k)}>
                  <input disabled={editor.locked} value={viewHeader[k] ?? ""} onChange={(e) => setHeaderField({ [k]: e.target.value })} required={k === "customerCompany"} />
                </Field>
              ))}
            </div>
          </PiEditorSection>
        )}

        <PiEditorSection
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
              <Changed key={idx} on={changes.items.has(idx)}>
                <LineItem
                  item={it}
                  product={products.find((p) => p.id === it.productId)}
                  language={language}
                  locked={editor.locked || showingSnapshot}
                  onChange={(next) => editor.setItems(editor.items.map((x, i) => i === idx ? next : x))}
                  onRemove={() => editor.setItems(editor.items.filter((_, i) => i !== idx))}
                />
              </Changed>
            ))}
          </div>
          {language === "EN" && <div className="text-right font-semibold">Total: {formatCurrency(editor.total, editor.totalCurrency)}</div>}
        </PiEditorSection>

        <PiEditorSection title="Other Requirements">
          <Changed on={changes.header.has("otherRequirements")}>
            <textarea
              className="w-full"
              disabled={editor.locked}
              rows={5}
              value={viewHeader.otherRequirements ?? ""}
              onChange={(e) => setHeaderField({ otherRequirements: e.target.value })}
            />
          </Changed>
        </PiEditorSection>

        {editor.events.length > 0 && (
          <Section title="Review History">
            {(editor.events as PiReviewEvent[]).map((e) => (
              <div key={e.id} className="border-t py-2 text-sm">
                {reviewEventLabel(e)} by {e.actorName || "—"}{e.note ? ` — ${e.note}` : ""}
                <span className="ml-2 text-xs text-slate-400">{e.createdAt}</span>
              </div>
            ))}
          </Section>
        )}

        {revisionFormOpen && (
          <Section title="Start a revision">
            <p className="mb-2 text-sm text-[#63749b]">
              The Chinese PI and its English PI reopen for editing and go through presales confirmation and commerce approval again.
              Until then the approved version stays in effect.
            </p>
            <textarea
              className="w-full"
              rows={3}
              placeholder="Reason for the change (required; shown to the reviewers)"
              value={revisionReason}
              onChange={(e) => setRevisionReason(e.target.value)}
            />
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn-primary" onClick={submitRevision}>Start revision</button>
              <button type="button" className="btn-secondary" onClick={() => setRevisionFormOpen(false)}>Cancel</button>
            </div>
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
            <>
              <Field label="Presales approver">
                <select value={editor.assignedToId} onChange={(e) => editor.setAssignedToId(e.target.value)}>
                  {recipients.filter((r) => r.role === "PRESALES" || r.role === "ADMIN").map((r) => (
                    <option key={r.id} value={r.id}>{r.displayName}{r.role === "ADMIN" ? " (Admin)" : ""}{r.feishuLinked ? "" : " — not on Feishu"}</option>
                  ))}
                </select>
              </Field>
              <Field label="Commerce approver">
                <select value={editor.commerceId} onChange={(e) => editor.setCommerceId(e.target.value)}>
                  <option value="">Any commerce user</option>
                  {recipients.filter((r) => r.role === "COMMERCE").map((r) => (
                    <option key={r.id} value={r.id}>{r.displayName}{r.feishuLinked ? "" : " — not on Feishu"}</option>
                  ))}
                </select>
              </Field>
            </>
          )}
          {!editor.locked && !editor.canConfirmReceivedZh && (
            <button className="btn-primary" disabled={editor.saving}>
              {editor.saving ? "Saving..." : language === "EN" ? "Save" : "Save Draft"}
            </button>
          )}
          {language === "ZH" && !editor.locked && !editor.canConfirmReceivedZh && <button type="button" className="btn-secondary" title="Sends the PI to the presales approver, then commerce" onClick={editor.submit}>Submit for Approval</button>}
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
          {canStartRevision && !revisionFormOpen && (
            <button type="button" className="btn-secondary" onClick={() => setRevisionFormOpen(true)}>Modify (start revision)</button>
          )}
          {(language === "EN" || (language === "ZH" && user?.role === "ADMIN" && editor.current?.status === "APPROVED")) && (
            <button
              type="button"
              className="btn-secondary"
              disabled={editor.exporting || !editor.current}
              title={editor.current ? "Download this PI as an Excel file" : "Save the PI first to download Excel"}
              onClick={editor.downloadExcel}
            >
              {editor.exporting ? "Generating..." : "Download Excel"}
            </button>
          )}
          {shouldShowLinkedZhSyncButton(language) && (
            <button
              type="button"
              className="btn-secondary"
              disabled={editor.saving || editor.resyncing || !editor.canResyncZh}
              title={
                !editor.current
                  ? "Save the PI first to sync it to a Chinese draft"
                  : editor.canResyncZh
                    ? editor.linkedZh
                      ? "Rebuild the linked Chinese draft from the latest English data"
                      : "Create a linked Chinese draft from this English PI"
                    : "Chinese draft is locked (already submitted or approved)"
              }
              onClick={editor.resyncZh}
            >
              {editor.saving || editor.resyncing ? "Syncing..." : editor.linkedZh ? "Re-sync to Chinese draft" : "Sync to Chinese draft"}
            </button>
          )}
        </div>
        {editor.linkedNotice && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-green-50 p-3 text-sm text-green-700">
            <span>{editor.linkedNotice}</span>
            <button type="button" className="text-green-700 underline" onClick={() => editor.setLinkedNotice("")}>Dismiss</button>
          </div>
        )}
        {editor.submitNotice && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            <span>{editor.submitNotice}</span>
            <button type="button" className="underline" onClick={() => editor.setSubmitNotice("")}>Dismiss</button>
          </div>
        )}
        {editor.exportError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{editor.exportError}</div>}
      </form>
      )}

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
  return `${pi.customerCompany} - ${piStatusLabel(pi.status)}`;
}

function piSectionTitle(pi: Pi, language: Language) {
  if (language === "EN") return piDisplayName(pi, language);
  return `${piDisplayName(pi, language)} - ${piStatusLabel(pi.status)} · ${revisionLabel(pi.revisionInProgress ? (pi.revisionNo ?? 1) + 1 : pi.revisionNo)}`;
}

// Marks a field or line item a revision changed relative to the approved version.
function Changed({ on, children }: { on: boolean; children: React.ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <div className="rounded-lg bg-amber-50 ring-2 ring-amber-300 ring-offset-2" title="Changed in this revision">
      {children}
    </div>
  );
}

function PiListSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-[72px] animate-pulse rounded-lg border border-[#e3ecff] bg-[#f5f9ff]" />
      ))}
    </div>
  );
}

// All PI sections share one calm blue palette so the workspace reads as a single
// coherent surface instead of a multi-colour patchwork.
const SECTION_STYLE = {
  card: "border-[#d5e3ff] bg-gradient-to-br from-white to-[#f5f9ff]",
  border: "border-[#e3ecff]",
  rail: "bg-[#2f6bd8]",
  title: "text-[#143a86]"
};

function PiEditorSection({
  title,
  children,
  action
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const style = SECTION_STYLE;
  return (
    <section className={`space-y-4 rounded-lg border p-5 shadow-[0_12px_32px_rgba(8,36,107,0.055)] ${style.card}`}>
      <div className={`flex flex-wrap items-center justify-between gap-3 border-b pb-4 ${style.border}`}>
        <div className="flex items-center gap-3">
          <span className={`h-8 w-1.5 rounded-full ${style.rail}`} />
          <h2 className={`text-lg font-semibold tracking-tight ${style.title}`}>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
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
