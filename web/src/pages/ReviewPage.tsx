import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import { api } from "../api/client";
import { EmptyState, PageHero, Section } from "../components/Form";
import { exportPi } from "../excel/exportPi";

const EXCEL_DOWNLOAD_TIMEOUT_MS = 45000;

export function ReviewPage() {
  const [queue, setQueue] = useState<any[]>([]);
  const [detail, setDetail] = useState<any | null>(null);
  const [note, setNote] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const load = () => api.get("/pi/review-queue").then((r) => setQueue(r.data));
  useEffect(() => { load(); }, []);

  async function open(id: string) {
    const res = await api.get(`/pi/${id}`);
    setDetail(res.data);
  }

  async function approve() {
    if (!detail) return;
    await api.post(`/pi/${detail.pi.id}/approve`);
    await open(detail.pi.id);
    await load();
  }

  async function reject() {
    if (!detail) return;
    await api.post(`/pi/${detail.pi.id}/reject`, { note });
    setDetail(null);
    setNote("");
    await load();
  }

  async function downloadExcel() {
    if (!detail) return;
    setExportError("");
    setExporting(true);
    try {
      await withTimeout(() => exportPi(detail.pi.id), EXCEL_DOWNLOAD_TIMEOUT_MS);
    } catch (err: any) {
      setExportError(err.response?.data?.error ?? err.message ?? "Excel download failed.");
    } finally {
      setExporting(false);
    }
  }

  return <div className="space-y-6">
    <PageHero
      eyebrow="Review queue"
      title="Pending Reviews"
      description="Open assigned Chinese PIs, review the details, then approve, reject, or export when everything is ready."
      Icon={Clock3}
    />
    <Section title="Pending Chinese PI Reviews">
      <p className="text-sm text-[#63749b]">Only PIs sent to you are shown here.</p>
      {queue.length === 0 ? (
        <EmptyState title="No pending reviews" description="When a Chinese PI is sent to you, it will appear here for approval or rejection." />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {queue.map((p) => (
            <button key={p.id} className="choice-card" onClick={() => open(p.id)}>
              {p.piNo}
              <br />
              <span className="text-xs text-slate-500">{p.customerCompany} - from {p.createdByName}</span>
            </button>
          ))}
        </div>
      )}
    </Section>
    {detail && <Section title={`${detail.pi.piNo} - ${detail.pi.status}`}>
      <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
        <Info label="Customer" value={detail.pi.customerCompany} />
        <Info label="Production Order No." value={detail.pi.productionOrderNo} />
        <Info label="Customer Source" value={detail.pi.customerSource} />
        <Info label="Customer Type" value={detail.pi.customerType} />
        <Info label="Delivery Date" value={detail.pi.deliveryDate} />
        <Info label="Address" value={detail.pi.customerAddress} />
      </div>
      <div className="space-y-2">
        {detail.items.map((it: any) => <div key={it.id} className="rounded-lg border border-[#e5edf9] bg-[#f8fbff] p-3 text-sm">
          <div className="font-medium">{it.nameZh} - {it.code} - Qty {it.quantity} - Price {it.unitPrice}</div>
          <div className="mt-2 grid grid-cols-3 gap-2">{JSON.parse(it.fieldValues || "[]").map((f: any, idx: number) => <span key={idx}>{f.label}: {f.value}</span>)}</div>
        </div>)}
      </div>
      <div className="space-y-2">
        <textarea className="w-full" rows={3} placeholder="Reject note" value={note} onChange={(e) => setNote(e.target.value)} />
        {detail.pi.status === "PENDING_REVIEW" && <div className="flex gap-2"><button className="btn-primary" onClick={approve}>Approve</button><button className="btn-danger" onClick={reject}>Reject</button><button className="btn-secondary" disabled={exporting} onClick={downloadExcel}>{exporting ? "Generating..." : "Download Excel"}</button></div>}
        {detail.pi.status === "APPROVED" && <button className="btn-primary" disabled={exporting} onClick={downloadExcel}>{exporting ? "Generating..." : "Download Excel"}</button>}
        {exportError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{exportError}</div>}
      </div>
      <div>{detail.events.map((e: any) => <div key={e.id} className="border-t py-2 text-sm">{e.action} by {e.actorName} - {e.note}</div>)}</div>
    </Section>}
  </div>;
}

function Info({ label, value }: { label: string; value?: string }) {
  return <div><div className="text-xs uppercase text-slate-500">{label}</div><div className="font-medium">{value || "-"}</div></div>;
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
