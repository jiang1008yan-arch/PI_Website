import { FormEvent, useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { api } from "../api/client";
import { ErrorText, Field, PageHero, Section } from "../components/Form";

type GroupState = {
  configured: boolean;
  chatId: string | null;
  // "setting": picked here; "env": the FEISHU_SERVICE_CHAT_ID fallback.
  source: "setting" | "env" | null;
  chats: { chatId: string; name: string }[];
  error?: string;
};

const DEFAULT_REMINDER_HOURS = 24;

// Admin: what the after-sales bot sends to the team. The after-sales group
// (picked from the groups the bot is in) gets the weekly summary, repeat-fault
// and device alerts; ticket owners get a private reminder when an open ticket
// has not been updated for the reminder interval.
export function TicketNotificationsPage() {
  return (
    <div className="space-y-6">
      <PageHero eyebrow="After-Sales" title="Ticket Notifications" description="What the after-sales bot sends, where and how often" Icon={BellRing} />
      <AfterSalesGroup />
      <UpdateReminders />
    </div>
  );
}

function AfterSalesGroup() {
  const [state, setState] = useState<GroupState | null>(null);
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const data = (await api.get("/feishu/service-chat")).data as GroupState;
    setState(data);
    setPicked(data.source === "setting" ? data.chatId ?? "" : "");
  }

  useEffect(() => {
    load().catch(() => setError("Could not load the after-sales group."));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await api.put("/feishu/service-chat", { chatId: picked });
      await load();
      setNotice(picked ? "Saved." : "Cleared.");
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await api.post("/feishu/service-chat/test");
      setNotice("Test message sent. Check the group in Feishu.");
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Could not send the test message.");
    } finally {
      setBusy(false);
    }
  }

  const savedPick = state?.source === "setting" ? state.chatId ?? "" : "";
  const nameOf = (chatId: string | null) => state?.chats.find((ch) => ch.chatId === chatId)?.name ?? chatId;

  return (
    <Section title="After-sales group">
      <form onSubmit={save} className="grid min-w-0 max-w-2xl gap-4 [overflow-wrap:anywhere]">
        <div className="space-y-2 text-sm text-[#294477]">
          <p>
            The <strong>weekly summary</strong>, <strong>repeat-fault alerts</strong> and <strong>device alerts</strong> go to this group.
            Without one, the bot still works in private chats; those messages are skipped.
          </p>
          <p>Add the bot <strong>售后工单Robot</strong> to your internal after-sales group first; it then appears in the list below.</p>
        </div>
        {state && !state.configured && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">The Feishu bot is not configured on this server (FEISHU_APP_ID / FEISHU_APP_SECRET).</div>
        )}
        {state?.configured && (
          <>
            <div className="text-sm text-[#294477]">
              Current group:{" "}
              {state.chatId ? (
                <strong>
                  {nameOf(state.chatId)}
                  {state.source === "env" ? " (from the FEISHU_SERVICE_CHAT_ID setting)" : ""}
                </strong>
              ) : (
                <span className="text-[#7184ab]">none</span>
              )}
            </div>
            <Field label="Group">
              <select value={picked} onChange={(e) => setPicked(e.target.value)} disabled={busy}>
                <option value="">{state.source === "env" ? "Use the FEISHU_SERVICE_CHAT_ID setting" : "None"}</option>
                {state.chats.map((ch) => (
                  <option key={ch.chatId} value={ch.chatId}>
                    {ch.name}
                  </option>
                ))}
              </select>
            </Field>
            {state.error && <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{state.error}</div>}
          </>
        )}
        <ErrorText message={error} />
        {notice && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div>}
        {state?.configured && (
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy || picked === savedPick}>
              Save
            </button>
            {state.chatId && (
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => void sendTest()}>
                Send test message
              </button>
            )}
          </div>
        )}
      </form>
    </Section>
  );
}

function UpdateReminders() {
  const [hours, setHours] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api
      .get("/options/ticketReminderHours")
      .then((res) => {
        const value = (res.data as { value: string }[])[0]?.value ?? String(DEFAULT_REMINDER_HOURS);
        setHours(value);
        setSaved(value);
      })
      .catch(() => setError("Could not load the reminder setting."));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    const n = Number(hours);
    if (!Number.isInteger(n) || n < 0 || n > 720) {
      setError("Enter whole hours from 0 to 720 (0 turns reminders off).");
      return;
    }
    setBusy(true);
    try {
      await api.put("/options/ticketReminderHours", { values: [String(n)] });
      setHours(String(n));
      setSaved(String(n));
      setNotice("Saved.");
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  const n = Number(saved);
  return (
    <Section title="Update reminders">
      <form onSubmit={save} className="grid min-w-0 max-w-2xl gap-4">
        <p className="text-sm text-[#294477]">
          When an open ticket (New or In progress) has not been updated for this many hours, its after-sales owner gets a private
          Feishu reminder, then again every this many hours until someone updates it. Owners who have not linked Feishu are not reminded.
        </p>
        <Field label="Remind after (hours)">
          <input type="number" min={0} max={720} step={1} value={hours} onChange={(e) => setHours(e.target.value)} disabled={busy} className="max-w-[10rem]" />
        </Field>
        <p className="text-xs text-[#7184ab]">
          {saved === "" ? "" : n === 0 ? "Reminders are off." : `Now: after ${n} hours without an update, then every ${n} hours. 0 turns reminders off.`}
        </p>
        <ErrorText message={error} />
        {notice && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div>}
        <div>
          <button className="btn-primary" disabled={busy || hours === saved}>
            Save
          </button>
        </div>
      </form>
    </Section>
  );
}
