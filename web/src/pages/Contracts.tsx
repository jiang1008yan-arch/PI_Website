import { useEffect, useState } from "react";
import { Folder } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState, PageHero, Section } from "../components/Form";
import { FilePicker } from "../products/FilePicker";

export function ContractsPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const load = () => api.get("/contract-templates").then((r) => setRows(r.data));

  useEffect(() => { load(); }, []);

  async function upload(file?: File) {
    if (!file) return;
    const key = `contracts/${Date.now()}-${file.name}`;
    await api.put(`/files/${encodeURIComponent(key)}`, file, { headers: { "content-type": file.type || "application/octet-stream" } });
    await api.post("/contract-templates", { name: file.name, language: "BOTH", r2Key: key, size: file.size });
    await load();
  }

  async function download(id: string) {
    const res = await api.get(`/contract-templates/${id}/download-url`);
    window.open(res.data.downloadUrl, "_blank");
  }

  return <div className="space-y-6">
    <PageHero
      eyebrow="Shared files"
      title="Contract Templates"
      description="Keep approved contract files close to the PI workflow so teams can download the right version quickly."
      Icon={Folder}
    />
    {user?.role === "ADMIN" && <Section title="Upload Contract">
      <div className="max-w-xl">
        <FilePicker label="File" accept="" onPick={upload} />
      </div>
    </Section>}
    <Section title="Contract Templates">
      {rows.length === 0 ? (
        <EmptyState title="No contract templates" description="Upload shared files so everyone can work from the same approved documents." />
      ) : (
        rows.map((r) => <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 border-t py-3 text-sm"><span className="font-medium text-[#294477]">{r.name} - {Math.round(r.size / 1024)} KB</span><span className="space-x-2"><button className="btn-secondary" onClick={() => download(r.id)}>Download</button>{user?.role === "ADMIN" && <button className="btn-danger" onClick={async () => { await api.delete(`/contract-templates/${r.id}`); load(); }}>Delete</button>}</span></div>)
      )}
    </Section>
  </div>;
}
