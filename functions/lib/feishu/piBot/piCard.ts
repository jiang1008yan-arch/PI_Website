// Feishu interactive cards (JSON 2.0) for the ZH PI approval chain. Pure
// builders — no I/O — so card shape is unit-tested. All copy is English
// (user-entered values are shown as typed).

// The approval step a pending ZH PI is waiting on.
export type ApprovalStep = "PRESALES" | "COMMERCE";

export function stepOf(status: string): ApprovalStep | null {
  if (status === "PENDING_REVIEW") return "PRESALES";
  if (status === "PENDING_COMMERCE") return "COMMERCE";
  return null;
}

export type CardPi = {
  id: string;
  piNo: string;
  productionOrderNo?: string | null;
  customerCompany?: string | null;
  deliveryDate?: string | null;
  customerSource?: string | null;
  customerType?: string | null;
  otherRequirements?: string | null;
  status: string;
  createdByName?: string | null;
  presalesName?: string | null;
  commerceName?: string | null;
  rejectionNote?: string | null;
};

export type CardItem = {
  productName: string;
  quantity: number;
  unitPrice: number;
  discountPct: number;
  fieldValues: Array<{ label: string; value: string }>;
};

// What the card is for:
//   action — the current approver: Approve / Reject / Edit buttons
//   closed — an earlier action card, now resolved (no buttons)
//   info   — a notice to the submitter (approved / rejected)
export type PiCardMode =
  // `note`: why this card reached an admin instead of the approver.
  | { kind: "action"; resubmission: boolean; note?: string }
  | { kind: "closed"; outcome: string }
  | { kind: "info"; message: string };

const MAX_ITEMS = 20;
export const STEP_LABEL: Record<ApprovalStep, string> = { PRESALES: "Presales", COMMERCE: "Commerce" };

export function piTitle(pi: CardPi): string {
  return pi.productionOrderNo?.trim() || pi.piNo;
}

function money(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function lineAmount(item: CardItem): number {
  return Number(item.quantity) * Number(item.unitPrice) * (1 - Number(item.discountPct) / 100);
}

// Visible product fields (hidden "__" meta fields are internal).
function itemFields(item: CardItem): string {
  return item.fieldValues
    .filter((f) => !f.label.startsWith("__") && String(f.value ?? "").trim())
    .map((f) => `${f.label}: ${f.value}`)
    .join(" · ");
}

// Escape characters Feishu markdown would interpret in user-entered text.
function md(text: string | null | undefined): string {
  return String(text ?? "").replace(/([*_~`<>\[\]])/g, "\\$1");
}

function headerFor(pi: CardPi, mode: PiCardMode) {
  const title = `PI ${piTitle(pi)}`;
  if (mode.kind === "action") {
    const step = stepOf(pi.status);
    return {
      title: { tag: "plain_text", content: `${title} · ${step ? `${STEP_LABEL[step]} approval` : "Approval"} needed` },
      subtitle: { tag: "plain_text", content: mode.resubmission ? "Resubmitted after changes" : "New submission" },
      template: "blue"
    };
  }
  if (mode.kind === "closed") {
    return { title: { tag: "plain_text", content: `${title} · ${mode.outcome}` }, template: "grey" };
  }
  return {
    title: { tag: "plain_text", content: `${title} · ${pi.status === "APPROVED" ? "Approved" : pi.status === "REJECTED" ? "Rejected" : "Update"}` },
    template: pi.status === "APPROVED" ? "green" : pi.status === "REJECTED" ? "red" : "blue"
  };
}

export function buildPiCard(pi: CardPi, items: CardItem[], mode: PiCardMode, editUrl: string) {
  const total = items.reduce((sum, it) => sum + lineAmount(it), 0);
  const facts = [
    `**Customer:** ${md(pi.customerCompany) || "—"}`,
    `**Production order no.:** ${md(pi.productionOrderNo) || "—"}`,
    `**Delivery date:** ${md(pi.deliveryDate) || "—"}`,
    `**Submitted by:** ${md(pi.createdByName) || "—"}`,
    `**Approval chain:** Presales ${md(pi.presalesName) || "any admin"} → Commerce ${md(pi.commerceName) || "any commerce user"}`
  ];
  if (pi.customerSource || pi.customerType) {
    facts.push(`**Customer source / type:** ${md(pi.customerSource) || "—"} / ${md(pi.customerType) || "—"}`);
  }

  const lines = items.slice(0, MAX_ITEMS).map((it, i) => {
    const fields = itemFields(it);
    const discount = Number(it.discountPct) ? ` · -${it.discountPct}%` : "";
    return `${i + 1}. **${md(it.productName)}** × ${it.quantity} @ ${money(Number(it.unitPrice))}${discount} = **${money(lineAmount(it))}**` +
      (fields ? `\n   ${md(fields)}` : "");
  });
  if (items.length > MAX_ITEMS) lines.push(`…and ${items.length - MAX_ITEMS} more line items. Open the PI on the website to see all.`);

  const elements: any[] = [
    ...(mode.kind === "action" && mode.note ? [{ tag: "markdown", content: `⚠️ ${md(mode.note)}` }, { tag: "hr" }] : []),
    { tag: "markdown", content: facts.join("\n") },
    { tag: "hr" },
    { tag: "markdown", content: lines.length ? `**Line items (${items.length})**\n${lines.join("\n")}` : "**Line items:** none" },
    { tag: "markdown", content: `**Total:** ${money(total)}` }
  ];
  if (pi.otherRequirements?.trim()) {
    elements.push({ tag: "markdown", content: `**Other requirements:** ${md(pi.otherRequirements)}` });
  }

  if (mode.kind === "info") {
    elements.push({ tag: "hr" }, { tag: "markdown", content: md(mode.message) });
  }
  if (mode.kind === "closed") {
    elements.push({ tag: "hr" }, { tag: "markdown", content: md(mode.outcome) });
  }

  const openButton = {
    tag: "button",
    text: { tag: "plain_text", content: mode.kind === "action" ? "Edit on website" : "Open on website" },
    type: "default",
    behaviors: [{ type: "open_url", default_url: editUrl }]
  };

  if (mode.kind === "action") {
    const value = { action: "pi_approve", piId: pi.id, status: pi.status };
    elements.push(
      { tag: "hr" },
      {
        tag: "column_set",
        columns: [
          {
            tag: "column",
            width: "auto",
            elements: [{
              tag: "button",
              text: { tag: "plain_text", content: pi.status === "PENDING_REVIEW" ? "Approve & send to Commerce" : "Approve" },
              type: "primary_filled",
              behaviors: [{ type: "callback", value }]
            }]
          },
          { tag: "column", width: "auto", elements: [openButton] }
        ]
      },
      {
        tag: "form",
        name: "reject_form",
        elements: [
          {
            tag: "input",
            name: "reason",
            placeholder: { tag: "plain_text", content: "Reason for rejection (required)" },
            max_length: 500
          },
          {
            tag: "button",
            name: "reject_submit",
            text: { tag: "plain_text", content: "Reject" },
            type: "danger",
            form_action_type: "submit",
            behaviors: [{ type: "callback", value: { action: "pi_reject", piId: pi.id, status: pi.status } }]
          }
        ]
      }
    );
  } else {
    elements.push(openButton);
  }

  return {
    schema: "2.0",
    config: { update_multi: true },
    header: headerFor(pi, mode),
    body: { elements }
  };
}
