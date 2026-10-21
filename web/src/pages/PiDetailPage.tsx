import { useEffect, useMemo, useState } from "react";
import { markSeen } from "../pi/notifications";
import { FileSearch } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState, PageHero, Section } from "../components/Form";
import { formatCurrency } from "../pi/format";
import { getMeta, visibleItemFields } from "../pi/lineItemFields";
import { generatedModelFor } from "../pi/modelRule";
import { labelForCustomer, labelForSender, piDisplayName, piStatusLabel, reviewEventLabel, revisionLabel } from "../pi/labels";
import { parsePiItems, type ParsedPiItem } from "../pi/piItemCodec";
import { revisionChanges, type RevisionChanges } from "../pi/piDiff";
import type { Language, Pi, PiReviewEvent } from "../types";
import { DeviceSerials } from "../pi/DeviceSerials";

// Read-only view of a ZH PI and its linked EN PI — where commerce approves or
// rejects, where after-sales looks a PI up, and the target of every approved-list
// link. Editing always happens in the PI workspace, never here.

type Content = { pi: Pi; items: ParsedPiItem[] };
type Pair = { current: Content | null; effective: Content | null };
type ViewData = { zh: Pair; en: Pair | null; events: PiReviewEvent[]; revisionNo?: number; revisionInProgress: boolean };

const parse = (c: any): Content | null => (c ? { pi: c.pi, items: parsePiItems(c.items ?? []) } : null);

export function PiDetailPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<ViewData | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Language>("ZH");
  const [rejectNote, setRejectNote] = useState("");
  const [busy, setBusy] = useState("");
  const [revisionReason, setRevisionReason] = useState("");

  async function load() {
    setError("");
    try {
      const res = await api.get(`/pi/${id}/view`);
      setData({
        zh: { current: parse(res.data.zh.current), effective: parse(res.data.zh.effective) },
        en: res.data.en ? { current: parse(res.data.en.current), effective: parse(res.data.en.effective) } : null,
        events: res.data.events ?? [],
        revisionNo: res.data.revisionNo,
        revisionInProgress: Boolean(res.data.revisionInProgress)
      });
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message ?? "Could not load this PI.");
    }
  }
  useEffect(() => { void load(); }, [id]);
  // Opening a PI counts as seeing it for the home badges.
  useEffect(() => {
    if (id) markSeen(["pendingReviews", "pendingCommerce", "confirmedReceived"], user?.id, [id]);
  }, [id, user?.id]);

  const status = (data?.zh.current ?? data?.zh.effective)?.pi.status;
  const underReview = status === "PENDING_REVIEW" || status === "PENDING_COMMERCE";
  // Reviewers look at the proposed (current) content; everyone else at the
  // effective version while a revision is still being edited.
  // After-sales never receives the current content, only the effective version.
  const showCurrent = Boolean(data?.zh.current) && (!data?.revisionInProgress || underReview);
  const pick = (pair: Pair | null | undefined) => (pair ? (showCurrent ? pair.current ?? pair.effective : pair.effective ?? pair.current) : null);
  const zh = pick(data?.zh);
  const en = pick(data?.en);
  const shown = tab === "EN" ? en : zh;
  const shownPair = tab === "EN" ? data?.en : data?.zh;
  const highlight = Boolean(data?.revisionInProgress && showCurrent);
  const changes = useMemo<RevisionChanges>(
    () =>
      highlight && shownPair?.effective && shown
        ? revisionChanges({ header: shownPair.effective.pi as any, items: shownPair.effective.items }, { header: shown.pi as any, items: shown.items })
        : { header: new Set(), items: new Set() },
    [highlight, shownPair, shown]
  );

  const isCommerceDecision = (user?.role === "COMMERCE" || user?.role === "ADMIN") && status === "PENDING_COMMERCE";
  const canDownload = user?.role !== "SERVICE" && (user?.role === "ADMIN" || user?.role === "COMMERCE" || tab === "EN");
  const owner = zh?.pi.createdById === user?.id;
  const canStartRevision = status === "APPROVED" && !data?.revisionInProgress && (user?.role === "ADMIN" || owner);
  const revisionNo = data?.revisionNo ?? 1;
  const reason = data?.zh.current?.pi.revisionReason;

  async function act(name: string, task: () => Promise<unknown>) {
    setError("");
    setBusy(name);
    try {
      await task();
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message ?? "Action failed.");
    } finally {
      setBusy("");
    }
  }

  const approve = () => act("approve", async () => {
    await api.post(`/pi/${id}/commerce-approve`);
    await load();
  });
  const reject = () => act("reject", async () => {
    if (!rejectNote.trim()) throw new Error("Please give a reason so the salesperson knows what to fix.");
    await api.post(`/pi/${id}/commerce-reject`, { note: rejectNote.trim() });
    navigate("/commerce");
  });
  const startRevision = () => act("revision", async () => {
    if (!revisionReason.trim()) throw new Error("Please give a reason for the change.");
    await api.post(`/pi/${id}/revisions`, { reason: revisionReason.trim() });
    navigate(`/pi/zh?piId=${id}`);
  });
  const download = (language: Language) => act(`download-${language}`, async () => {
    const target = language === "EN" ? en : zh;
    if (!target) return;
    const { exportPi } = await import("../excel/exportPi");
    // Download what is on screen: during a revision that is the frozen
    // effective version, unless a reviewer is looking at the proposal.
    await exportPi(target.pi.id, data?.revisionInProgress && !showCurrent ? "effective" : "current");
  });

  if (error && !data) {
    return <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }
  if (!data || !zh) return <div className="text-sm text-slate-500">Loading…</div>;

  const title = piDisplayName({ ...zh.pi, linkedPiNo: en?.pi.piNo ?? zh.pi.linkedPiNoSnapshot } as Pi, "ZH");

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow={`${piStatusLabel(showCurrent ? status ?? "" : "APPROVED")} · ${revisionLabel(data.revisionInProgress && showCurrent ? revisionNo + 1 : revisionNo)}`}
        title={title}
        description={`${zh.pi.customerCompany}${zh.pi.productionOrderNo ? ` · Production Order No. ${zh.pi.productionOrderNo}` : ""}`}
        Icon={FileSearch}
      />

      {data.revisionInProgress && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {showCurrent ? (
            <>
              <strong>{revisionLabel(revisionNo + 1)} for review.</strong> Reason: {reason || "—"}. Highlighted fields and lines differ from the approved {revisionLabel(revisionNo)}.
            </>
          ) : (
            <>
              A revision is being prepared. You are looking at the approved {revisionLabel(revisionNo)}, which stays in effect until the revision is approved.
              {(user?.role === "ADMIN" || owner) && (
                <> <Link className="underline" to={`/pi/zh?piId=${id}`}>Open the revision in the editor</Link>.</>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={tab === "ZH" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("ZH")}>Chinese PI</button>
        {en && <button type="button" className={tab === "EN" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("EN")}>English PI</button>}
        <span className="flex-1" />
        {canDownload && shown && (
          <button type="button" className="btn-secondary" disabled={Boolean(busy)} onClick={() => download(tab)}>
            {busy === `download-${tab}` ? "Generating…" : `Download ${tab === "ZH" ? "Chinese" : "English"} Excel`}
          </button>
        )}
      </div>

      {shown ? <PiContent content={shown} language={tab} changes={changes} /> : <EmptyState title="Nothing to show" description="This PI has no content for this language." />}

      {tab === "ZH" && (status === "APPROVED" || data.revisionInProgress) && <DeviceSerials piId={id} />}

      {data.events.length > 0 && (
        <Section title="Review History">
          {data.events.map((e) => (
            <div key={e.id} className="border-t py-2 text-sm">
              {reviewEventLabel(e)} by {e.actorName || "—"}{e.note ? ` — ${e.note}` : ""}
              <span className="ml-2 text-xs text-slate-400">{e.createdAt}</span>
            </div>
          ))}
        </Section>
      )}

      {isCommerceDecision && (
        <Section title="Commerce approval">
          <p className="mb-3 text-sm text-[#63749b]">
            Check the Chinese and English PIs, then approve or reject. Commerce cannot edit; a rejection goes back to the salesperson and restarts at presales confirmation.
          </p>
          <textarea
            className="w-full"
            rows={3}
            placeholder="Reason for rejecting (required to reject)"
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
          />
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn-primary" disabled={Boolean(busy)} onClick={approve}>{busy === "approve" ? "Approving…" : "Approve"}</button>
            <button type="button" className="btn-danger" disabled={Boolean(busy)} onClick={reject}>{busy === "reject" ? "Rejecting…" : "Reject"}</button>
          </div>
        </Section>
      )}

      {canStartRevision && (
        <Section title="Modify this PI">
          <p className="mb-2 text-sm text-[#63749b]">
            Starting a revision reopens the Chinese and English PIs for editing. It goes through presales confirmation and commerce approval again; until then {revisionLabel(revisionNo)} stays in effect.
          </p>
          <textarea
            className="w-full"
            rows={3}
            placeholder="Reason for the change (required; shown to the reviewers)"
            value={revisionReason}
            onChange={(e) => setRevisionReason(e.target.value)}
          />
          <div className="mt-3">
            <button type="button" className="btn-secondary" disabled={Boolean(busy)} onClick={startRevision}>Start revision</button>
          </div>
        </Section>
      )}

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    </div>
  );
}

const ZH_HEADER = [
  ["productionOrderNo", "Production Order No."],
  ["customerCompany", "Customer"],
  ["customerSource", "Customer Source"],
  ["customerType", "Customer Type"],
  ["deliveryDate", "Delivery Date"],
  ["date", "Date"]
] as const;
const EN_HEADER = [
  ["piNo", "PI No."],
  ["date", "Date"],
  ["validUntil", "Valid Until"],
  ["incoterm", "Incoterm"],
  ["shipmentMode", "Shipment Mode"],
  ["paymentTerm", "Payment Term"]
] as const;
const EN_PARTIES = ["customerCompany", "customerContact", "customerEmail", "customerPhone", "customerAddress"] as const;
const EN_SENDER = ["senderCorp", "senderAddress", "senderFrom", "senderPhone", "senderEmail"] as const;

function PiContent({ content, language, changes }: { content: Content; language: Language; changes: RevisionChanges }) {
  const pi = content.pi as Record<string, any>;
  const rows: [string, string][] =
    language === "ZH"
      ? ZH_HEADER.map(([k, l]) => [k, l])
      : [
          ...EN_HEADER.map(([k, l]) => [k, l] as [string, string]),
          ...EN_PARTIES.map((k) => [k, `Customer ${labelForCustomer(k)}`] as [string, string]),
          ...EN_SENDER.map((k) => [k, `Sender ${labelForSender(k)}`] as [string, string])
        ];
  const total = content.items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.unitPrice) * (1 - Number(it.discountPct) / 100), 0);

  return (
    <div className="space-y-6">
      <Section title={language === "ZH" ? "Chinese PI" : "English PI"}>
        <dl className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(([key, label]) => (
            <div key={key} className={`rounded-lg border p-3 ${changes.header.has(key) ? "border-amber-300 bg-amber-50" : "border-[#e3ecff] bg-white"}`}>
              <dt className="text-xs font-medium uppercase tracking-wide text-[#8595b6]">{label}</dt>
              <dd className="mt-1 break-words text-sm text-[#07183f]">{pi[key] || "—"}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="Products / Line Items">
        {content.items.length === 0 ? (
          <EmptyState title="No products" description="This PI has no line items." />
        ) : (
          <div className="space-y-3">
            {content.items.map((item, idx) => {
              const model = generatedModelFor(item);
              const currency = getMeta(item, "currency") || "USD";
              return (
                <div key={idx} className={`rounded-lg border p-4 ${changes.items.has(idx) ? "border-amber-300 bg-amber-50" : "border-[#e3ecff] bg-white"}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="font-semibold text-[#07183f]">{(language === "ZH" ? item.nameZh : item.nameEn) || item.code || item.productId}</div>
                    <div className="text-sm text-[#294477]">
                      Qty {item.quantity} · {language === "EN" ? formatCurrency(Number(item.unitPrice), currency) : item.unitPrice}
                      {Number(item.discountPct) ? ` · ${item.discountPct}% off` : ""}
                    </div>
                  </div>
                  {model.model && <div className="mt-1 text-sm text-[#294477]">Model: {model.model}</div>}
                  <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm md:grid-cols-2">
                    {visibleItemFields(item).map((f) => (
                      <div key={f.label}><span className="text-[#8595b6]">{f.label}:</span> {f.value || "—"}</div>
                    ))}
                  </div>
                </div>
              );
            })}
            {language === "EN" && <div className="text-right font-semibold">Total: {formatCurrency(total, getMeta(content.items[0], "currency") || "USD")}</div>}
          </div>
        )}
      </Section>

      {pi.otherRequirements && (
        <Section title="Other Requirements">
          <div className={`whitespace-pre-wrap rounded-lg p-3 text-sm ${changes.header.has("otherRequirements") ? "bg-amber-50 ring-2 ring-amber-300" : ""}`}>{pi.otherRequirements}</div>
        </Section>
      )}
    </div>
  );
}
