import { useEffect, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { api } from "../api/client";
import { EmptyState, Field, PageHero, Section } from "../components/Form";
import { FilePicker } from "../products/FilePicker";

type Language = "EN" | "ZH";

const availableFields = {
  EN: [
    ["piNo", "PI No"],
    ["date", "Date"],
    ["validUntil", "Valid Until"],
    ["incoterm", "Incoterm"],
    ["shipmentMode", "Shipment Mode"],
    ["paymentTerm", "Payment Term"],
    ["customer.company", "Customer Company"],
    ["customer.contact", "Customer Contact"],
    ["customer.email", "Customer Email"],
    ["customer.phone", "Customer Phone"],
    ["customer.address", "Customer Address"],
    ["sender.corp", "Sender Corp"],
    ["sender.address", "Sender Address"],
    ["sender.from", "Sender From"],
    ["sender.phone", "Sender Phone"],
    ["sender.email", "Sender Email"],
    ["totalAmount", "Total Amount"],
    ["otherRequirements", "Other Requirements"]
  ],
  ZH: [
    ["piNo", "PI No"],
    ["date", "Date"],
    ["productionOrderNo", "Production Order No."],
    ["customerSource", "Customer Source"],
    ["customerType", "Customer Type"],
    ["deliveryDate", "Delivery Date"],
    ["customer.company", "Customer Company"],
    ["customer.contact", "Customer Contact"],
    ["customer.email", "Customer Email"],
    ["customer.phone", "Customer Phone"],
    ["customer.address", "Customer Address"],
    ["sender.corp", "Sender Corp"],
    ["sender.address", "Sender Address"],
    ["sender.from", "Sender From"],
    ["sender.phone", "Sender Phone"],
    ["sender.email", "Sender Email"],
    ["totalAmount", "Total Amount"],
    ["otherRequirements", "Other Requirements"]
  ]
} as const;

export function TemplatesPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [language, setLanguage] = useState<Language>("EN");
  const [anchor, setAnchor] = useState("PRODUCTS_START");
  const [positionLanguage, setPositionLanguage] = useState<Language>("EN");
  const [positions, setPositions] = useState<Record<string, string>>({});
  const [fieldToAdd, setFieldToAdd] = useState("");
  const [saved, setSaved] = useState("");
  const load = () => api.get("/excel-templates").then((r) => setTemplates(r.data));

  useEffect(() => { load(); }, []);
  useEffect(() => { loadPositions(positionLanguage); }, [positionLanguage]);

  async function loadPositions(lang: Language) {
    const res = await api.get(`/options/piFieldPositions${lang}`);
    const entries = res.data
      .map((row: any) => String(row.value).split("="))
      .filter((pair: string[]) => pair.length === 2);
    setPositions(Object.fromEntries(entries));
    setFieldToAdd("");
  }

  async function upload(file?: File) {
    if (!file) return;
    const key = `excel-templates/${language.toLowerCase()}.xlsx`;
    await api.put(`/files/${encodeURIComponent(key)}`, file, { headers: { "content-type": file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
    await api.post("/excel-templates", { language, r2Key: key, anchorCellName: anchor });
    await load();
  }

  async function savePositions() {
    const values = Object.entries(positions)
      .map(([key, cell]) => [key, cell.trim().toUpperCase()] as const)
      .filter(([, cell]) => cell)
      .map(([key, cell]) => `${key}=${cell}`);
    await api.put(`/options/piFieldPositions${positionLanguage}`, { values });
    setSaved(`${positionLanguage} field positions saved.`);
    setTimeout(() => setSaved(""), 1800);
  }

  const selectedFields = availableFields[positionLanguage].filter(([key]) => key in positions);
  const unselectedFields = availableFields[positionLanguage].filter(([key]) => !(key in positions));

  function addPositionField() {
    if (!fieldToAdd) return;
    setPositions({ ...positions, [fieldToAdd]: positions[fieldToAdd] ?? "" });
    setFieldToAdd("");
  }

  function removePositionField(key: string) {
    const next = { ...positions };
    delete next[key];
    setPositions(next);
  }

  return <div className="space-y-6">
    <PageHero
      eyebrow="Excel setup"
      title="Excel Template Settings"
      Icon={LayoutGrid}
    />
    <Section title="Upload PI Header Template">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Language"><select value={language} onChange={(e) => setLanguage(e.target.value as Language)}><option>EN</option><option>ZH</option></select></Field>
        <Field label="Anchor Name"><input value={anchor} onChange={(e) => setAnchor(e.target.value)} /></Field>
        <FilePicker label="Excel File" onPick={upload} />
      </div>
      <p className="text-sm text-slate-500">Anchor Name marks where product rows start in Excel. Default is PRODUCTS_START.</p>
    </Section>

    <Section title="PI Field Positions" action={saved ? <span className="text-sm text-primary">{saved}</span> : null}>
      <div className="flex gap-2">
        <button type="button" className={positionLanguage === "EN" ? "btn-primary" : "btn-secondary"} onClick={() => setPositionLanguage("EN")}>English PI</button>
        <button type="button" className={positionLanguage === "ZH" ? "btn-primary" : "btn-secondary"} onClick={() => setPositionLanguage("ZH")}>Chinese PI</button>
      </div>
      <p className="text-sm text-slate-500">Choose only the PI fields used by your Excel header, then set each exact cell, for example B2 or F8.</p>
      <div className="flex max-w-2xl gap-2">
        <select className="flex-1" value={fieldToAdd} onChange={(e) => setFieldToAdd(e.target.value)}>
          <option value="">Select a PI field to map...</option>
          {unselectedFields.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <button type="button" className="btn-secondary" onClick={addPositionField}>Add Field</button>
      </div>
      <div className="space-y-3">
        {selectedFields.length === 0 && <div className="rounded-lg bg-[#f8fbff] p-3 text-sm text-[#63749b]">No fields added yet.</div>}
        {selectedFields.map(([key, label]) => (
          <div key={key} className="grid grid-cols-1 items-end gap-3 rounded-lg border border-[#e5edf9] bg-[#f8fbff] p-3 md:grid-cols-[1fr_180px_auto]">
            <div>
              <div className="text-sm font-medium">{label}</div>
              <div className="text-xs text-slate-500">{key}</div>
            </div>
            <Field label="Excel Cell">
              <input
                value={positions[key] ?? ""}
                placeholder="e.g. B2"
                onChange={(e) => setPositions({ ...positions, [key]: e.target.value })}
              />
            </Field>
            <button type="button" className="btn-danger" onClick={() => removePositionField(key)}>Delete</button>
          </div>
        ))}
      </div>
      <button type="button" className="btn-primary w-fit" onClick={savePositions}>Save Field Positions</button>
    </Section>

    <Section title="Templates">
      {templates.length === 0 ? (
        <EmptyState title="No templates uploaded" description="Upload an Excel header template above, then map the fields it needs." />
      ) : (
        templates.map((t) => <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 border-t py-3 text-sm"><span className="font-medium text-[#294477]">{t.language} - {t.r2Key} - {t.anchorCellName}</span><button className="btn-danger" onClick={async () => { await api.delete(`/excel-templates/${t.language}`); load(); }}>Delete</button></div>)
      )}
    </Section>
  </div>;
}
