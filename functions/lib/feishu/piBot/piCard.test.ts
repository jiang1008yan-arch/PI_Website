import { describe, expect, it } from "vitest";
import { buildPiCard, lineAmount, type CardItem, type CardPi } from "./piCard";

const pi: CardPi = {
  id: "pi-1",
  piNo: "ZH-20261020-001",
  productionOrderNo: "SO-1001",
  customerCompany: "Acme_[Corp]",
  deliveryDate: "2026-12-01",
  status: "PENDING_REVIEW",
  createdByName: "Alice",
  presalesName: "Pat",
  commerceName: "Cam"
};

const item = (n: number): CardItem => ({
  productName: `Valve ${n}`,
  quantity: 2,
  unitPrice: 100,
  discountPct: 10,
  fieldValues: [{ label: "型号", value: `V-${n}` }, { label: "__currency", value: "CNY" }]
});

const allText = (card: any) => JSON.stringify(card);
const buttons = (card: any) =>
  JSON.stringify(card).match(/"tag":"button"/g)?.length ?? 0;

describe("buildPiCard", () => {
  it("action card for presales: approve hands off to commerce, has reject form and edit link", () => {
    const card = buildPiCard(pi, [item(1)], { kind: "action", resubmission: false }, "https://x/pi/zh?piId=pi-1");
    const text = allText(card);
    expect(card.header.title.content).toBe("PI SO-1001 · Presales approval needed");
    expect(text).toContain("Approve & send to Commerce");
    expect(text).toContain('"action":"pi_approve"');
    expect(text).toContain('"action":"pi_reject"');
    expect(text).toContain('"form_action_type":"submit"');
    expect(text).toContain("https://x/pi/zh?piId=pi-1");
    expect(buttons(card)).toBe(3);
  });

  it("commerce step says plain Approve", () => {
    const card = buildPiCard({ ...pi, status: "PENDING_COMMERCE" }, [item(1)], { kind: "action", resubmission: true }, "u");
    expect(card.header.title.content).toContain("Commerce approval needed");
    expect(card.header.subtitle?.content).toBe("Resubmitted after changes");
    expect(allText(card)).toContain('"content":"Approve"');
  });

  it("closed and info cards carry no action buttons", () => {
    const closed = buildPiCard(pi, [item(1)], { kind: "closed", outcome: "Approved by Pat (Presales)" }, "u");
    const info = buildPiCard({ ...pi, status: "REJECTED" }, [item(1)], { kind: "info", message: "Rejected: price" }, "u");
    for (const card of [closed, info]) {
      expect(allText(card)).not.toContain("pi_approve");
      expect(allText(card)).not.toContain("pi_reject");
      expect(buttons(card)).toBe(1);
    }
    expect(info.header.template).toBe("red");
  });

  it("shows line amounts, total, visible fields only, and escapes markdown in user text", () => {
    const card = buildPiCard(pi, [item(1), item(2)], { kind: "action", resubmission: false }, "u");
    const text = allText(card);
    expect(lineAmount(item(1))).toBe(180);
    expect(text).toContain("**Total:** 360.00");
    expect(text).toContain("型号: V-1");
    expect(text).not.toContain("__currency");
    expect(text).toContain("Acme\\\\_\\\\[Corp\\\\]");
  });

  it("caps line items and stays well under Feishu's 30KB card limit", () => {
    const items = Array.from({ length: 60 }, (_, i) => item(i));
    const card = buildPiCard({ ...pi, otherRequirements: "x".repeat(2000) }, items, { kind: "action", resubmission: false }, "u");
    expect(allText(card)).toContain("…and 40 more line items");
    expect(new TextEncoder().encode(allText(card)).length).toBeLessThan(30 * 1024);
  });
});
