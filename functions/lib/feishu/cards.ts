// Feishu card JSON 2.0 builders (pure). Cards are sent with update_multi so a
// ticket's single card can be refreshed in place for everyone in the group.

export type TicketCardData = {
  id: string;
  ticketNo: string;
  status: "NEW" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  ticketType?: string | null;
  customerCompany: string;
  orderNo: string;
  contactName: string;
  productName: string | null;
  productModel: string | null;
  serialNumber: string | null;
  faultType: string | null;
  serviceName: string | null;
  salesName: string | null;
  latestNote: string | null;
  repeat?: { count: number; windowDays: number } | null;
};

export const STATUS_TEXT: Record<TicketCardData["status"], string> = {
  NEW: "New",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  CLOSED: "Closed"
};

// Next statuses offered on the card — the same transitions as the portal.
const NEXT: Record<TicketCardData["status"], TicketCardData["status"][]> = {
  NEW: ["IN_PROGRESS"],
  IN_PROGRESS: ["RESOLVED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: []
};

export const TYPE_TEXT: Record<string, string> = { FAULT: "Fault", PRODUCT_REQUEST: "Product request", OTHER: "Question / other" };

const TEMPLATE: Record<TicketCardData["status"], string> = { NEW: "red", IN_PROGRESS: "orange", RESOLVED: "green", CLOSED: "grey" };

const plain = (content: string) => ({ tag: "plain_text", content });
const md = (content: string) => ({ tag: "markdown", content });
// Card markdown treats these characters specially; customer text must not format.
const esc = (value: unknown) => String(value ?? "").replace(/([\\`*_~[\]<>])/g, "\\$1");

function callbackButton(text: string, value: Record<string, string>, opts: { type?: string; name?: string; submit?: boolean } = {}) {
  return {
    tag: "button",
    ...(opts.name ? { name: opts.name } : {}),
    text: plain(text),
    type: opts.type ?? "default",
    ...(opts.submit ? { form_action_type: "submit" } : {}),
    behaviors: [{ type: "callback", value }]
  };
}

export function ticketCard(t: TicketCardData, portalUrl: string | null) {
  const facts = [
    `**Production order:** ${esc(t.orderNo) || "—"}`,
    `**Product:** ${esc(t.productName) || "—"}${t.productModel ? ` · ${esc(t.productModel)}` : ""}${t.serialNumber ? ` · SN ${esc(t.serialNumber)}` : ""}`,
    `**Type:** ${TYPE_TEXT[t.ticketType ?? ""] ?? "not classified"}${t.ticketType === "FAULT" ? ` · ${esc(t.faultType) || "fault type not confirmed"}` : ""}`,
    `**Contact:** ${esc(t.contactName)}`,
    `**After-sales:** ${esc(t.serviceName) || "unassigned"} · **Sales:** ${esc(t.salesName) || "—"}`
  ].join("\n");
  const elements: unknown[] = [md(facts)];
  if (t.latestNote) elements.push(md(`**Latest:** ${esc(t.latestNote)}`));
  if (t.repeat) elements.push(md(`**Repeat fault:** ${t.repeat.count} times on this product in ${t.repeat.windowDays} days`));
  // Whoever created the ticket usually owns it already; Take is for unowned ones.
  if (!t.serviceName && t.status !== "CLOSED") elements.push(callbackButton("Take", { action: "take", ticketId: t.id }, { type: "primary" }));
  const next = NEXT[t.status];
  if (t.status !== "CLOSED") {
    elements.push({
      tag: "form",
      name: "update_form",
      elements: [
        ...(next.length
          ? [{ tag: "select_static", name: "status", placeholder: plain("Change status (optional)"), options: next.map((s) => ({ text: plain(STATUS_TEXT[s]), value: s })) }]
          : []),
        { tag: "input", name: "note", placeholder: plain("Progress note (optional)"), max_length: 1000 },
        callbackButton("Update", { action: "update", ticketId: t.id }, { type: "primary", name: "submit_update", submit: true })
      ]
    });
  }
  if (portalUrl) elements.push(md(`[Open in portal](${portalUrl}/tickets/${t.id})`));
  return {
    schema: "2.0",
    config: { update_multi: true },
    header: { title: plain(`${t.ticketNo} · ${STATUS_TEXT[t.status]}`), subtitle: plain(t.customerCompany || "—"), template: TEMPLATE[t.status] },
    body: { elements }
  };
}

// One piece of collected material, as the cards list it.
export type CardItem = {
  id: string;
  kind: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "FILE";
  text: string | null;
  fileName: string | null;
  durationMs: number | null;
  problem: "IN_FORWARD" | "TOO_LARGE" | "DOWNLOAD_FAILED" | null;
};

// Cards list the latest items; earlier ones are folded into a count.
export const CARD_ITEM_LIMIT = 10;

const KIND_TEXT: Record<CardItem["kind"], [string, string]> = {
  TEXT: ["text", "texts"],
  IMAGE: ["picture", "pictures"],
  AUDIO: ["voice message", "voice messages"],
  VIDEO: ["video", "videos"],
  FILE: ["file", "files"]
};

const PROBLEM_TEXT: Record<NonNullable<CardItem["problem"]>, string> = {
  IN_FORWARD: "not saved — Feishu does not let bots download files inside a merged forward; forward this one on its own",
  TOO_LARGE: "not saved — larger than 50 MB; view it in Feishu",
  DOWNLOAD_FAILED: "not saved — it could not be downloaded; forward it again"
};

const clock = (ms: number | null) => (ms ? ` ${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}` : "");

export function collectedCounts(items: CardItem[]): string {
  const counts = new Map<CardItem["kind"], number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  return (Object.keys(KIND_TEXT) as CardItem["kind"][])
    .filter((k) => counts.has(k))
    .map((k) => `${counts.get(k)} ${KIND_TEXT[k][counts.get(k) === 1 ? 0 : 1]}`)
    .join(" · ");
}

function itemLabel(item: CardItem): string {
  const preview = (text: string | null, n: number) => (text ? `: ${esc(text.replace(/\s+/g, " ").slice(0, n))}${text.length > n ? "…" : ""}` : "");
  let label: string;
  if (item.kind === "TEXT") label = `Text${preview(item.text, 120)}`;
  else if (item.kind === "AUDIO") label = `Voice message${clock(item.durationMs)}${preview(item.text, 80)}`;
  else if (item.kind === "IMAGE") label = "Picture";
  else if (item.kind === "VIDEO") label = `Video${clock(item.durationMs)}`;
  else label = `File${item.fileName ? `: ${esc(item.fileName)}` : ""}`;
  return item.problem ? `${label} <font color='red'>(${PROBLEM_TEXT[item.problem]})</font>` : label;
}

// The latest items, each with a Remove button. In the form the buttons submit
// it, so what has been typed is kept when the card is redrawn.
function itemElements(draftId: string, items: CardItem[], inForm: boolean): unknown[] {
  const shown = items.slice(-CARD_ITEM_LIMIT);
  const hidden = items.length - shown.length;
  const elements: unknown[] = [md(`**Collected:** ${collectedCounts(items) || "nothing yet"}${hidden ? ` (latest ${shown.length} shown, ${hidden} earlier)` : ""}`)];
  shown.forEach((item, i) => {
    elements.push({
      tag: "column_set",
      columns: [
        { tag: "column", width: "weighted", weight: 5, vertical_align: "center", elements: [md(`${hidden + i + 1}. ${itemLabel(item)}`)] },
        {
          tag: "column",
          width: "auto",
          vertical_align: "center",
          elements: [
            callbackButton("Remove", { action: "remove_item", draftId, itemId: item.id }, inForm ? { name: `remove_${i}`, submit: true } : {})
          ]
        }
      ]
    });
  });
  return elements;
}

// The private card of an open request while material is being collected.
export function collectCard(d: { draftId: string; items: CardItem[] }) {
  return {
    schema: "2.0",
    config: { update_multi: true },
    header: { title: plain("New after-sales ticket request"), template: "blue" },
    body: {
      elements: [
        md(
          "Everything you send me now goes into this request: texts, pictures, voice messages, videos and files, forwarded one by one or merged. Pictures, voice messages and videos inside a **merged** forward cannot be saved — forward those **one by one**."
        ),
        ...itemElements(d.draftId, d.items, false),
        callbackButton("Prepare ticket", { action: "open_draft", draftId: d.draftId }, { type: "primary" }),
        callbackButton("Discard", { action: "dismiss_draft", draftId: d.draftId })
      ]
    }
  };
}

export type WeeklySummary = {
  weekOf: string;
  created: number;
  resolved: number;
  open: { ticketNo: string; customerCompany: string; status: string; ownerName: string | null; ageDays: number }[];
  repeats: { productName: string; faultType: string; count: number; windowDays: number }[];
};

export const OVERDUE_DAYS = 7;

// The Monday summary for the after-sales group: last week's numbers, every open
// ticket by owner (overdue ones flagged), and repeat faults that grew last week.
export function weeklySummaryCard(s: WeeklySummary, portalUrl: string | null) {
  const elements: unknown[] = [md(`**Last 7 days:** ${s.created} new · ${s.resolved} resolved · ${s.open.length} still open`)];
  const byOwner = new Map<string, WeeklySummary["open"]>();
  for (const t of s.open) {
    const owner = t.ownerName ?? "No owner";
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), t]);
  }
  for (const [owner, tickets] of byOwner) {
    const lines = tickets.slice(0, 15).map((t) => {
      const line = `${t.ticketNo} · ${esc(t.customerCompany) || "—"} · ${STATUS_TEXT[t.status as TicketCardData["status"]] ?? t.status} · ${t.ageDays} d`;
      return t.ageDays > OVERDUE_DAYS ? `- <font color='red'>${line}</font>` : `- ${line}`;
    });
    if (tickets.length > 15) lines.push(`- … and ${tickets.length - 15} more`);
    elements.push(md(`**${esc(owner)}** (${tickets.length})\n${lines.join("\n")}`));
  }
  if (s.repeats.length) {
    elements.push(
      md(`**Repeat faults**\n${s.repeats.map((r) => `- ${esc(r.productName)} · ${esc(r.faultType)}: ${r.count} times in ${r.windowDays} days`).join("\n")}`)
    );
  }
  if (portalUrl) elements.push(md(`[Open tickets in portal](${portalUrl}/tickets)`));
  return {
    schema: "2.0",
    header: { title: plain(`After-sales weekly summary · week of ${s.weekOf}`), template: "blue" },
    body: { elements }
  };
}

export type DeviceAlertData = {
  draftId: string;
  serialNumber: string;
  kind: "FAULT" | "OFFLINE";
  faultCode: string | null;
  faultText: string | null;
  since: string | null;
  registered: boolean;
  customerCompany: string | null;
  productionOrderNo: string | null;
  piNo: string | null;
};

// A device problem reported by the charger backend, posted to the after-sales
// group. "创建工单" opens the usual ticket form here; whoever submits owns it.
export function deviceAlertCard(a: DeviceAlertData) {
  const problem =
    a.kind === "FAULT"
      ? `**Fault:** ${esc(a.faultCode) || "—"}${a.faultText ? ` · ${esc(a.faultText)}` : ""}`
      : `**Offline since:** ${esc(a.since) || "—"} (UTC)`;
  const facts = [
    `**SN:** ${esc(a.serialNumber)}${a.registered ? "" : " (not registered on any PI)"}`,
    problem,
    `**Customer:** ${esc(a.customerCompany) || "—"}`,
    `**Production order:** ${esc(a.productionOrderNo) || "—"}${a.piNo ? ` · PI ${esc(a.piNo)}` : ""}`
  ].join("\n");
  return {
    schema: "2.0",
    config: { update_multi: true },
    header: { title: plain(`Device alert · ${a.serialNumber}`), template: a.kind === "FAULT" ? "red" : "orange" },
    body: {
      elements: [md(facts), callbackButton("Create ticket", { action: "open_draft", draftId: a.draftId }, { type: "primary" })]
    }
  };
}

// What an owner's old card turns into after the ticket is handed over.
export function handedOverCard(ticketNo: string, newOwner: string | null) {
  return {
    schema: "2.0",
    config: { update_multi: true },
    header: { title: plain(`${ticketNo} · handed over`), template: "grey" },
    body: { elements: [md(newOwner ? `This ticket is now handled by ${esc(newOwner)}.` : "This ticket no longer has an after-sales owner.")] }
  };
}

export function expiredDraftCard() {
  return {
    schema: "2.0",
    config: { update_multi: true },
    header: { title: plain("Expired"), template: "grey" },
    body: { elements: [md("Nothing was added to this request for 6 hours, so it has expired. Send me the messages again to start a new one.")] }
  };
}

export function dismissedCard() {
  return {
    schema: "2.0",
    config: { update_multi: true },
    header: { title: plain("Discarded"), template: "grey" },
    body: { elements: [md("No ticket was created. Send me messages whenever you need a new one.")] }
  };
}

// The group's device alert card once someone took it to their private chat.
export function alertTakenCard(serialNumber: string, byName: string) {
  return {
    schema: "2.0",
    config: { update_multi: true },
    header: { title: plain(`Device alert · ${serialNumber}`), template: "grey" },
    body: { elements: [md(`${esc(byName)} is preparing a ticket for this alert in their private chat with me.`)] }
  };
}

// Values already in the form, kept when the card is redrawn (e.g. after "Find").
export type DraftPrefill = {
  customerCompany?: string;
  orderNo?: string;
  contactName?: string;
  serialNumber?: string;
  summary?: string;
  // The ticket's first note: the AI's roll-up of all the material, editable.
  details?: string;
  ticketType?: string;
  faultType?: string;
  lookupQuery?: string;
  // The customer group to tell about the ticket ("none" or a chat id).
  notifyChat?: string;
};

// Earlier tickets like this one (lib/similarTickets.ts), as the card shows them.
export type CardSimilarLayer = {
  key: "SN" | "ORDER" | "CUSTOMER" | "FAULT";
  value: string;
  total: number;
  openDuplicate: boolean;
  tickets: { id: string; ticketNo: string; createdAt: string; customerCompany: string; status: string; summary: string | null }[];
};

export type DraftCardData = {
  draftId: string;
  text: string;
  aiSummary: string | null;
  aiDigest?: string | null;
  aiTicketType: string | null;
  aiFaultType: string | null;
  faultTypes: string[];
  prefill?: DraftPrefill;
  // Results of "Find": production orders, SNs and customers already in the system.
  matches?: { value: string; label: string }[] | null;
  createdTicketNo?: string | null;
  // Set when this card became the ticket's own card (its creator owns it):
  // "Update progress" then turns it into the ticket card.
  createdTicketId?: string | null;
  items?: CardItem[];
  // What the AI could not look at (e.g. videos), and whether the material
  // changed since it ran.
  aiNotes?: string[];
  changedSinceAi?: { added: number; removed: number } | null;
  similar?: { layers: CardSimilarLayer[]; windowDays: number } | null;
  // Groups the bot is in, for "Notify customer group".
  chats?: { chatId: string; name: string }[];
  portalUrl?: string | null;
};

const LAYER_TITLE: Record<CardSimilarLayer["key"], (value: string, windowDays: number) => string> = {
  SN: (v) => `Same device (SN ${esc(v)})`,
  ORDER: (v) => `Same production order (${esc(v)})`,
  CUSTOMER: (v) => `Same customer (${esc(v)})`,
  FAULT: (v, days) => `Same fault type (${esc(v)}), last ${days} days`
};

export function similarElements(similar: NonNullable<DraftCardData["similar"]>, portalUrl: string | null | undefined): unknown[] {
  if (!similar.layers.length) return [md("**Earlier tickets like this:** none found.")];
  const blocks = similar.layers.map((layer) => {
    const lines = layer.tickets.map((t) => {
      const no = portalUrl ? `[${esc(t.ticketNo)}](${portalUrl}/tickets/${t.id})` : esc(t.ticketNo);
      const status = STATUS_TEXT[t.status as TicketCardData["status"]] ?? t.status;
      return `- ${no} · ${t.createdAt.slice(0, 10)} · ${esc(t.customerCompany) || "—"} · ${status}${t.summary ? ` · ${esc(t.summary.slice(0, 120))}` : ""}`;
    });
    if (layer.total > layer.tickets.length) {
      const more = `${layer.total - layer.tickets.length} more`;
      lines.push(portalUrl ? `- [${more}](${portalUrl}/tickets?q=${encodeURIComponent(layer.value)})` : `- ${more}`);
    }
    const warning = layer.openDuplicate ? "\n<font color='red'>This device already has an open ticket — check it before creating a duplicate.</font>" : "";
    return `**${LAYER_TITLE[layer.key](layer.value, similar.windowDays)}** (${layer.total})${warning}\n${lines.join("\n")}`;
  });
  return [md(`**Earlier tickets like this**\n${blocks.join("\n")}`)];
}

// Feishu refuses the whole card when an input allows more than this.
export const INPUT_MAX_LENGTH = 1000;

const textInput = (name: string, label: string, maxLength: number, value?: string, rows?: number) => {
  const limit = Math.min(maxLength, INPUT_MAX_LENGTH);
  return {
    tag: "input",
    name,
    placeholder: plain(label),
    max_length: limit,
    ...(rows ? { input_type: "multiline_text", rows, auto_resize: true } : {}),
    ...(value ? { default_value: value.slice(0, limit) } : {})
  };
};

// The private form of a request ("Prepare ticket"). Nothing is created until
// a staff member submits it; AI suggestions are marked as such. It lists the
// collected material and earlier tickets like this one. "Find" looks the
// typed text up among existing production orders, customers and SNs;
// "Re-recognize" runs the AI again on the material as it is now. Every button
// in the form submits it, so what has been typed survives the redraw.
export function draftCard(d: DraftCardData) {
  if (d.createdTicketNo) {
    const files = d.items?.filter((i) => i.kind !== "TEXT" && !i.problem).length ?? 0;
    const elements: unknown[] = [md(`> ${esc(d.text).slice(0, 500)}${files ? `\n\n${files} file(s) attached to the ticket.` : ""}`)];
    if (d.createdTicketId) elements.push(callbackButton("Update progress", { action: "show_ticket", ticketId: d.createdTicketId }));
    if (d.createdTicketId && d.portalUrl) elements.push(md(`[Open in portal](${d.portalUrl}/tickets/${d.createdTicketId})`));
    return {
      schema: "2.0",
      config: { update_multi: true },
      header: { title: plain(`Ticket ${d.createdTicketNo} created`), template: "green" },
      body: { elements }
    };
  }
  const p = d.prefill ?? {};
  const ticketType = p.ticketType ?? d.aiTicketType ?? "";
  const faultType = p.faultType ?? d.aiFaultType ?? "";
  const elements: unknown[] = [];
  if (d.changedSinceAi && (d.changedSinceAi.added || d.changedSinceAi.removed)) {
    const parts = [d.changedSinceAi.added ? `${d.changedSinceAi.added} added` : "", d.changedSinceAi.removed ? `${d.changedSinceAi.removed} removed` : ""].filter(Boolean);
    elements.push(md(`<font color='orange'>The material changed since the AI looked at it (${parts.join(", ")}). Press **Re-recognize** to include the changes.</font>`));
  }
  // Without items (a request from before collecting), show its text instead.
  if (!d.items?.length) elements.push(md(`**Customer message**\n> ${esc(d.text).slice(0, 1500)}`));
  if (d.aiSummary) {
    // The roll-up itself is in the Details box, where it can be corrected.
    elements.push(md(`**AI summary of all the messages** (symptoms only; check before creating): ${esc(d.aiSummary)}${d.aiDigest ? " — details in the form below." : ""}`));
  }
  for (const note of d.aiNotes ?? []) elements.push(md(`<font color='grey'>${esc(note)}</font>`));
  // The SN is never typed: it comes from the message, a device alert or a pick.
  if (p.serialNumber) elements.push(md(`**Device SN:** ${esc(p.serialNumber)}`));
  if (d.similar) elements.push(...similarElements(d.similar, d.portalUrl));
  const formElements: unknown[] = [
    ...(d.items?.length ? itemElements(d.draftId, d.items, true) : []),
    textInput("lookupQuery", "Find: type part of a production order, customer or SN", 100, p.lookupQuery),
    callbackButton("Find", { action: "lookup_draft", draftId: d.draftId }, { name: "submit_lookup", submit: true })
  ];
  if (d.matches) {
    formElements.push(
      d.matches.length
        ? {
            tag: "select_static",
            name: "match",
            placeholder: plain(`Pick a match (${d.matches.length}) — fills customer, order and SN`),
            options: d.matches.map((m) => ({ text: plain(m.label.slice(0, 100)), value: m.value }))
          }
        : md("No production order, customer or SN matches that. Fill in the fields below.")
    );
  }
  formElements.push(
    // Placeholders double as labels: only well-documented component properties are used.
    textInput("customerCompany", "Customer company", 200, p.customerCompany),
    textInput("orderNo", "Production order no., e.g. PO-2026-0901", 100, p.orderNo),
    textInput("contactName", "Customer contact name (required)", 200, p.contactName),
    textInput("summary", "One-line summary (optional)", 300, p.summary ?? d.aiSummary ?? undefined),
    textInput("details", "Details for the ticket (optional; the original messages are kept too)", INPUT_MAX_LENGTH, p.details ?? d.aiDigest ?? undefined, 5),
    {
      tag: "select_static",
      name: "ticketType",
      placeholder: plain("Ticket type (optional)"),
      ...(TYPE_TEXT[ticketType] ? { initial_option: ticketType } : {}),
      options: Object.entries(TYPE_TEXT).map(([value, text]) => ({ text: plain(text), value }))
    },
    ...(d.faultTypes.length
      ? [{
          tag: "select_static",
          name: "faultType",
          placeholder: plain("Fault type (faults only, optional)"),
          ...(d.faultTypes.includes(faultType) ? { initial_option: faultType } : {}),
          options: d.faultTypes.map((f) => ({ text: plain(f), value: f }))
        }]
      : []),
    ...(d.chats?.length
      ? [{
          tag: "select_static",
          name: "notifyChat",
          placeholder: plain("Notify a customer group (optional)"),
          initial_option: d.chats.some((ch) => ch.chatId === p.notifyChat) ? p.notifyChat : "none",
          options: [
            { text: plain("Don't notify any group"), value: "none" },
            ...d.chats.slice(0, 99).map((ch) => ({ text: plain(ch.name.slice(0, 100)), value: ch.chatId }))
          ]
        }]
      : []),
    ...(d.items?.length ? [callbackButton("Re-recognize", { action: "rerun_draft", draftId: d.draftId }, { name: "submit_rerun", submit: true })] : []),
    callbackButton("Create ticket", { action: "confirm_draft", draftId: d.draftId }, { type: "primary", name: "submit_draft", submit: true })
  );
  elements.push({ tag: "form", name: "draft_form", elements: formElements });
  elements.push(callbackButton("Discard", { action: "dismiss_draft", draftId: d.draftId }));
  return {
    schema: "2.0",
    config: { update_multi: true },
    header: { title: plain("Turn into an after-sales ticket?"), template: "blue" },
    body: { elements }
  };
}

export function bindCard(link: string) {
  return {
    schema: "2.0",
    header: { title: plain("Link your Feishu account"), template: "blue" },
    body: {
      elements: [
        md("Your Feishu account is not linked to a portal account yet. Sign in once with Feishu and your portal username and password, or ask an admin to add your Feishu mobile number in Permission Management."),
        { tag: "button", text: plain("Sign in with Feishu"), type: "primary", behaviors: [{ type: "open_url", default_url: link }] }
      ]
    }
  };
}
