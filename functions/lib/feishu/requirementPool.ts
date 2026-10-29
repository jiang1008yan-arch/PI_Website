// The product managers' requirement pool: a Feishu Bitable they own, with the
// bot added as an editor. Each ticket classified as a product request is
// written there once as a row; filtering, export, assignment and notifying
// product managers happen in Bitable itself (pure helpers; I/O in sync.ts).

import { customerWordsOf } from "./requestNote";

export const POOL_URL_OPTION_KEY = "requirementPoolUrl";

// Column names the table must have, all of type Text (多行文本).
export const POOL_FIELDS = ["工单号", "提交日期", "客户", "产品", "型号", "SN", "摘要", "客户原话", "售后负责人", "工单链接"] as const;

const BITABLE_TEXT_TYPE = 1;

// https://<tenant>.feishu.cn/base/<app_token>?table=<table_id>&view=...
export function parsePoolUrl(raw: string): { appToken: string; tableId: string } | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const match = /\/base\/([A-Za-z0-9]+)/.exec(url.pathname);
  const tableId = url.searchParams.get("table");
  if (!match || !tableId || !/^tbl[A-Za-z0-9]+$/.test(tableId)) return null;
  return { appToken: match[1], tableId };
}

export type PoolCheck = { missing: string[]; notText: string[] };

export function checkPoolFields(items: { field_name: string; type: number }[]): PoolCheck {
  const byName = new Map(items.map((f) => [f.field_name, f.type]));
  return {
    missing: POOL_FIELDS.filter((name) => !byName.has(name)),
    notText: POOL_FIELDS.filter((name) => byName.has(name) && byName.get(name) !== BITABLE_TEXT_TYPE)
  };
}

export type PoolTicket = {
  id: string;
  ticketNo: string;
  createdAt: string;
  customerCompany: string;
  productName: string | null;
  productModel: string | null;
  serialNumber: string | null;
  summary: string | null;
  firstNote: string | null;
  serviceName: string | null;
};

export function poolRecordFields(t: PoolTicket, portalUrl: string | null): Record<(typeof POOL_FIELDS)[number], string> {
  // Tickets created from Feishu start their timeline with the customer's words.
  const note = t.firstNote ?? "";
  const original = customerWordsOf(note).slice(0, 2000);
  return {
    工单号: t.ticketNo,
    提交日期: t.createdAt.slice(0, 10),
    客户: t.customerCompany || "",
    产品: t.productName ?? "",
    型号: t.productModel ?? "",
    SN: t.serialNumber ?? "",
    摘要: t.summary || original.slice(0, 200),
    客户原话: original,
    售后负责人: t.serviceName ?? "",
    工单链接: portalUrl ? `${portalUrl}/tickets/${t.id}` : ""
  };
}
