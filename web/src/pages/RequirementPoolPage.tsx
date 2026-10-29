import { FormEvent, useEffect, useState } from "react";
import { Lightbulb } from "lucide-react";
import { api } from "../api/client";
import { ErrorText, Field, PageHero, Section } from "../components/Form";
import { useBotName } from "../hooks/useBotName";

const FIELDS = ["工单号", "提交日期", "客户", "产品", "型号", "SN", "摘要", "客户原话", "售后负责人", "工单链接"];

type Check = { ok: boolean; error?: string; missing?: string[]; notText?: string[] };

// Admin: where product requests go. The product managers own a Feishu Bitable
// (the requirement pool); each ticket classified as a product request is
// written there once, and they filter, export and get notified in Bitable.
export function RequirementPoolPage() {
  const bot = useBotName();
  const [url, setUrl] = useState("");
  const [savedUrl, setSavedUrl] = useState("");
  const [check, setCheck] = useState<Check | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get("/options/requirementPoolUrl")
      .then((res) => {
        const value = (res.data as { value: string }[])[0]?.value ?? "";
        setUrl(value);
        setSavedUrl(value);
      })
      .catch(() => setError("Could not load the saved link."));
  }, []);

  async function runCheck() {
    setCheck(null);
    setCheck((await api.get("/feishu/requirement-pool/check")).data);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.put("/options/requirementPoolUrl", { values: url.trim() ? [url.trim()] : [] });
      setSavedUrl(url.trim());
      if (url.trim()) await runCheck();
      else setCheck(null);
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Could not save the link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHero eyebrow="Administration" title="Requirement Pool" description="Where product requests from tickets go" Icon={Lightbulb} />
      <Section title="Feishu Bitable link">
        <form onSubmit={save} className="grid min-w-0 max-w-2xl gap-4 [overflow-wrap:anywhere]">
          <div className="space-y-2 text-sm text-[#294477]">
            <p>When after-sales mark a ticket as a <strong>Product request</strong>, it is added once as a row to this table.</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>A product manager creates a Bitable with a table whose columns are exactly: <span className="font-medium">{FIELDS.join("、")}</span> (all of type Text / 文本).</li>
              <li>In the base, Share → add the app <strong>{bot}</strong> as an editor (可编辑).</li>
              <li>Open the table and copy the link from the address bar (it contains <code>/base/…?table=tbl…</code>), paste it below and save.</li>
              <li>Optional: in the base, Automations → "When a record is added" → send a Feishu message to the product managers.</li>
            </ol>
          </div>
          <Field label="Table link">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxx.feishu.cn/base/…?table=tbl…" disabled={busy} />
          </Field>
          <ErrorText message={error} />
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy || url.trim() === savedUrl}>Save</button>
            {savedUrl && (
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => void runCheck()}>
                Check table
              </button>
            )}
          </div>
          {check && (
            <div className={`break-all rounded-lg px-3 py-2 text-sm ${check.ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
              {check.ok
                ? "The table is reachable and has all the columns."
                : check.error ??
                  [
                    check.missing?.length ? `Missing columns: ${check.missing.join("、")}.` : "",
                    check.notText?.length ? `Change these to Text (文本): ${check.notText.join("、")}.` : ""
                  ].join(" ")}
            </div>
          )}
        </form>
      </Section>
    </div>
  );
}
