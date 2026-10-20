import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { Download, FileText, Paperclip, X } from "lucide-react";
import { api } from "../api/client";
import { EmptyState, Section } from "../components/Form";
import type { Ticket, TicketAttachment, TicketStatus, TicketUpdate } from "../types";
import { STATUS_BADGE, STATUS_LABEL, formatDateTime } from "./ticketShared";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;

async function fetchAttachment(ticketId: string, a: TicketAttachment, inline = false): Promise<string> {
  const res = await api.get(`/tickets/${ticketId}/attachments/${a.id}`, { params: inline ? { inline: 1 } : {}, responseType: "blob" });
  return URL.createObjectURL(res.data as Blob);
}

async function download(ticketId: string, a: TicketAttachment) {
  const url = await fetchAttachment(ticketId, a);
  const link = document.createElement("a");
  link.href = url;
  link.download = a.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// A picture shown as a thumbnail (click to open full size), or a file chip;
// both download. Files are fetched with the signed-in session, never public.
function AttachmentItem({ ticketId, a }: { ticketId: string; a: TicketAttachment }) {
  const isImage = a.contentType.startsWith("image/");
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    if (!isImage) return;
    let url: string | null = null;
    let cancelled = false;
    fetchAttachment(ticketId, a, true)
      .then((u) => {
        url = u;
        if (!cancelled) setThumb(u);
      })
      .catch(() => setThumb(null));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [ticketId, a.id, isImage]);

  if (isImage) {
    return (
      <div className="group relative h-24 w-24 overflow-hidden rounded-lg border border-[#dbe6fb] bg-[#f5f8ff]">
        {thumb ? (
          <button type="button" className="h-full w-full" title={`${a.fileName} · open`} onClick={() => window.open(thumb, "_blank")}>
            <img src={thumb} alt={a.fileName} className="h-full w-full object-cover" />
          </button>
        ) : (
          <div className="grid h-full place-items-center text-xs text-[#8595b6]">Loading…</div>
        )}
        <button
          type="button"
          title={`Download ${a.fileName}`}
          aria-label={`Download ${a.fileName}`}
          className="absolute bottom-1 right-1 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-[#294477] shadow opacity-90 hover:text-primary"
          onClick={() => void download(ticketId, a)}
        >
          <Download size={14} />
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      title={`Download ${a.fileName}`}
      className="flex max-w-full items-center gap-2 rounded-lg border border-[#dbe6fb] bg-white px-3 py-2 text-left text-sm text-[#294477] hover:border-primary/40 hover:text-primary"
      onClick={() => void download(ticketId, a)}
    >
      <FileText size={16} className="shrink-0" />
      <span className="truncate">{a.fileName}</span>
      <span className="shrink-0 text-xs text-[#8595b6]">{formatSize(a.size)}</span>
      <Download size={14} className="shrink-0" />
    </button>
  );
}

function Attachments({ ticketId, items }: { ticketId: string; items: TicketAttachment[] }) {
  if (!items.length) return null;
  const images = items.filter((a) => a.contentType.startsWith("image/"));
  const files = items.filter((a) => !a.contentType.startsWith("image/"));
  return (
    <div className="mt-2 space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((a) => (
            <AttachmentItem key={a.id} ticketId={ticketId} a={a} />
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((a) => (
            <AttachmentItem key={a.id} ticketId={ticketId} a={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function NoteBody({ ticketId, update, attachments }: { ticketId: string; update: TicketUpdate; attachments: TicketAttachment[] }) {
  return (
    <>
      <div className="text-xs text-[#8595b6]">
        {formatDateTime(update.createdAt)} · {update.actorName ?? "System"}
      </div>
      {update.note && <div className="whitespace-pre-wrap text-sm text-[#07183f]">{update.note}</div>}
      <Attachments ticketId={ticketId} items={attachments} />
    </>
  );
}

// Write an update (text and/or files), as a new update or added to the latest.
function Composer({ ticket, latestId, onChanged }: { ticket: Ticket; latestId: string | null; onChanged: () => Promise<void> }) {
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files ?? []);
    const tooBig = chosen.filter((f) => f.size > MAX_FILE_BYTES);
    setError(tooBig.length ? `Too large (max 20 MB): ${tooBig.map((f) => f.name).join(", ")}` : "");
    setFiles((prev) => [...prev, ...chosen.filter((f) => f.size <= MAX_FILE_BYTES && f.size > 0)]);
    e.target.value = "";
  }

  async function submit(parentId: string | null) {
    setError("");
    setBusy(true);
    try {
      const res = await api.post(`/tickets/${ticket.id}/notes`, { note: note.trim(), parentId, withAttachments: files.length > 0 });
      for (const file of files) {
        await api.post(`/tickets/${ticket.id}/updates/${res.data.id}/attachments`, file, {
          headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) }
        });
      }
      setNote("");
      setFiles([]);
      await onChanged();
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Could not save the update.");
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  const empty = !note.trim() && files.length === 0;
  return (
    <div className="space-y-3 border-t pt-4">
      <textarea
        rows={3}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={4000}
        placeholder={latestId ? "Add to the latest update, or post a new update…" : "Write the first progress update…"}
      />
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-full bg-[#eef3ff] px-3 py-1 text-xs text-[#294477]">
              {f.name} · {formatSize(f.size)}
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <div className="text-sm text-red-700">{error}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <input ref={input} type="file" multiple className="hidden" onChange={pick} />
        <button type="button" className="btn-secondary inline-flex items-center gap-1.5" disabled={busy} onClick={() => input.current?.click()}>
          <Paperclip size={15} />
          Attach pictures / files
        </button>
        <div className="flex-1" />
        {latestId && (
          <button type="button" className="btn-secondary" disabled={busy || empty} onClick={() => void submit(latestId)}>
            Add note to latest update
          </button>
        )}
        <button type="button" className="btn-primary" disabled={busy || empty} onClick={() => void submit(null)}>
          {busy ? "Saving…" : "Post new update"}
        </button>
      </div>
    </div>
  );
}

// show="latest": where the ticket stands and the most recent progress update
// (with its pictures, files and follow-up notes), and room to add to it.
// show="history": every status change and note, oldest first.
export function TicketActivity({
  show,
  ticket,
  updates,
  attachments,
  canManage,
  onChanged
}: {
  show: "latest" | "history";
  ticket: Ticket;
  updates: TicketUpdate[];
  attachments: TicketAttachment[];
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const filesOf = useMemo(() => {
    const map = new Map<string, TicketAttachment[]>();
    for (const a of attachments) map.set(a.updateId, [...(map.get(a.updateId) ?? []), a]);
    return (updateId: string) => map.get(updateId) ?? [];
  }, [attachments]);
  const followUps = useMemo(() => {
    const map = new Map<string, TicketUpdate[]>();
    for (const u of updates) if (u.parentId) map.set(u.parentId, [...(map.get(u.parentId) ?? []), u]);
    return (updateId: string) => map.get(updateId) ?? [];
  }, [updates]);
  const topLevel = updates.filter((u) => !u.parentId);
  const latest = [...topLevel].reverse().find((u) => u.kind === "NOTE" && !u.isSystem) ?? null;

  if (show === "latest") {
    return (
      <Section title="Latest status">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-sm font-medium ${STATUS_BADGE[ticket.status]}`}>{STATUS_LABEL[ticket.status]}</span>
            {ticket.assignedServiceName && <span className="text-sm text-[#63749b]">Owner: {ticket.assignedServiceName}</span>}
          </div>
          {latest ? (
            <div className="rounded-lg border border-[#e3ecff] bg-[#f8fbff] p-4">
              <NoteBody ticketId={ticket.id} update={latest} attachments={filesOf(latest.id)} />
              {followUps(latest.id).length > 0 && (
                <ol className="mt-3 space-y-3 border-l-2 border-[#dbe6fb] pl-4">
                  {followUps(latest.id).map((f) => (
                    <li key={f.id}>
                      <NoteBody ticketId={ticket.id} update={f} attachments={filesOf(f.id)} />
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : (
            <p className="text-sm text-[#63749b]">No progress update yet.</p>
          )}
          {canManage && <Composer ticket={ticket} latestId={latest?.id ?? null} onChanged={onChanged} />}
        </div>
      </Section>
    );
  }

  return (
      <Section title="Activity">
        {topLevel.length === 0 ? (
          <EmptyState title="No activity yet" description="Status changes and notes will appear here." />
        ) : (
          <ol className="space-y-4">
            {topLevel.map((u) => (
              <li key={u.id} className="border-l-2 border-[#e1e9f8] pl-4">
                {u.kind === "STATUS" ? (
                  <>
                    <div className="text-xs text-[#8595b6]">
                      {formatDateTime(u.createdAt)} · {u.actorName ?? "System"}
                    </div>
                    <div className="text-sm text-[#294477]">
                      Status changed <span className="font-medium">{STATUS_LABEL[(u.statusFrom as TicketStatus) ?? "NEW"]}</span> →{" "}
                      <span className="font-medium">{STATUS_LABEL[(u.statusTo as TicketStatus) ?? "NEW"]}</span>
                    </div>
                  </>
                ) : u.isSystem ? (
                  <>
                    <div className="text-xs text-[#8595b6]">
                      {formatDateTime(u.createdAt)} · {u.actorName ?? "System"}
                    </div>
                    <div className="text-sm italic text-[#63749b]">{u.note}</div>
                  </>
                ) : (
                  <NoteBody ticketId={ticket.id} update={u} attachments={filesOf(u.id)} />
                )}
                {followUps(u.id).length > 0 && (
                  <ol className="mt-2 space-y-2 border-l-2 border-[#eef3fd] pl-4">
                    {followUps(u.id).map((f) => (
                      <li key={f.id}>
                        <NoteBody ticketId={ticket.id} update={f} attachments={filesOf(f.id)} />
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ol>
        )}
      </Section>
  );
}
