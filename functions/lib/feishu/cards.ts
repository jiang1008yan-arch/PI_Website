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

// The first reply to an @-mention or direct message: ask before doing anything.
export function promptCard(d: { draftId: string; text: string }) {
  return {
    schema: "2.0",
    config: { update_multi: true },
    header: { title: plain("要把这条消息创建为售后工单吗？ Create a ticket?"), template: "blue" },
    body: {
      elements: [
        md(`> ${esc(d.text).slice(0, 500)}`),
        callbackButton("创建工单 Create ticket", { action: "open_draft", draftId: d.draftId }, { type: "primary" }),
        callbackButton("忽略 Ignore", { action: "dismiss_draft", draftId: d.draftId })
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
    header: { title: plain("已失效 Expired"), template: "grey" },
    body: { elements: [md("这个建单请求超过 6 小时没有提交，已失效。需要时请重新 @我 或私聊我。")] }
  };
}

export function dismissedCard() {
  return {
    schema: "2.0",
    config: { update_multi: true },
    header: { title: plain("已忽略 Ignored"), template: "grey" },
    body: { elements: [md("没有创建工单。需要时再 @我 或私聊我即可。")] }
  };
}

export type DraftCardData = {
  draftId: string;
  text: string;
  aiSummary: string | null;
  aiTicketType: string | null;
  aiFaultType: string | null;
  faultTypes: string[];
  createdTicketNo?: string | null;
};

// The private confirmation card for a "turn into ticket" request. Nothing is
// created until a staff member submits it; AI suggestions are marked as such.
export function draftCard(d: DraftCardData) {
  if (d.createdTicketNo) {
    return {
      schema: "2.0",
      config: { update_multi: true },
      header: { title: plain(`Ticket ${d.createdTicketNo} created`), template: "green" },
      body: { elements: [md(`> ${esc(d.text).slice(0, 500)}`)] }
    };
  }
  const elements: unknown[] = [md(`**Customer message**\n> ${esc(d.text).slice(0, 1500)}`)];
  if (d.aiSummary) elements.push(md(`**AI suggestion** (check before creating): ${esc(d.aiSummary)}`));
  elements.push({
    tag: "form",
    name: "draft_form",
    elements: [
      // Placeholders double as labels: only well-documented component properties are used.
      { tag: "input", name: "customerCompany", placeholder: plain("Customer company"), max_length: 200 },
      { tag: "input", name: "orderNo", placeholder: plain("Production order no., e.g. PO-2026-0901"), max_length: 100 },
      { tag: "input", name: "contactName", placeholder: plain("Customer contact name (required)"), max_length: 200 },
      {
        tag: "input",
        name: "summary",
        placeholder: plain("One-line summary (optional)"),
        max_length: 300,
        ...(d.aiSummary ? { default_value: d.aiSummary.slice(0, 300) } : {})
      },
      {
        tag: "select_static",
        name: "ticketType",
        placeholder: plain("Ticket type (optional)"),
        ...(d.aiTicketType && TYPE_TEXT[d.aiTicketType] ? { initial_option: d.aiTicketType } : {}),
        options: Object.entries(TYPE_TEXT).map(([value, text]) => ({ text: plain(text), value }))
      },
      ...(d.faultTypes.length
        ? [{
            tag: "select_static",
            name: "faultType",
            placeholder: plain("Fault type (faults only, optional)"),
            ...(d.aiFaultType && d.faultTypes.includes(d.aiFaultType) ? { initial_option: d.aiFaultType } : {}),
            options: d.faultTypes.map((f) => ({ text: plain(f), value: f }))
          }]
        : []),
      callbackButton("Create ticket", { action: "confirm_draft", draftId: d.draftId }, { type: "primary", name: "submit_draft", submit: true })
    ]
  });
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
        md("Before you can update tickets from Feishu, link this Feishu account to your portal account once."),
        { tag: "button", text: plain("Link account"), type: "primary", behaviors: [{ type: "open_url", default_url: link }] }
      ]
    }
  };
}
