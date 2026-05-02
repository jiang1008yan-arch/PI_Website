import type ExcelJS from "exceljs";

export type FieldRecord = { label: string; value: string };

export type ExportBundle = {
  pi: any;
  items: any[];
  sender: any;
  excelTemplateUrl: string | null;
  anchorCellName: string;
  productTemplateUrls: Record<string, string>;
};

export function tokensFor(data: ExportBundle): Record<string, string> {
  const pi = data.pi;
  const sender = data.sender ?? {};
  const totalCurrency = data.items[0] ? meta(JSON.parse(data.items[0].fieldValues || "[]"), "currency") || "USD" : "USD";
  const totalAmount = data.items.reduce((sum, item) => {
    return sum + Number(item.quantity) * Number(item.unitPrice) * (1 - Number(item.discountPct) / 100);
  }, 0);
  const base: Record<string, string> = {
    piNo: pi.piNo,
    date: pi.date,
    validUntil: pi.validUntil,
    incoterm: pi.incoterm,
    shipmentMode: pi.shipmentMode,
    paymentTerm: pi.paymentTerm,
    otherRequirements: pi.otherRequirements,
    productionOrderNo: pi.productionOrderNo,
    customerSource: pi.customerSource,
    customerType: pi.customerType,
    deliveryDate: pi.deliveryDate,
    "customer.company": pi.customerCompany,
    "customer.contact": pi.customerContact,
    "customer.email": pi.customerEmail,
    "customer.phone": pi.customerPhone,
    "customer.country": pi.customerCountry,
    "customer.address": pi.customerAddress,
    "sender.corp": pi.senderCorp || sender.corp,
    "sender.address": pi.senderAddress || sender.address,
    "sender.from": pi.senderFrom || sender.fromName,
    "sender.phone": pi.senderPhone || sender.phone,
    "sender.email": pi.senderEmail || sender.email,
    totalAmount: `${currencySymbol(totalCurrency)}${formatNumber(totalAmount)}`
  };
  return Object.fromEntries(Object.entries(base).map(([k, v]) => [`\${${k}}`, v ?? ""]));
}

export function fieldTokens(fields: FieldRecord[]) {
  return Object.fromEntries(
    fields
      .filter((f) => !f.label.startsWith("__"))
      .map((f) => [`\${field.${f.label}}`, f.value ?? ""])
  );
}

export function itemTokens(item: any, fields: FieldRecord[]) {
  const currency = meta(fields, "currency") || "USD";
  const generated = generatedModel(fields);
  const model = fieldValue(fields, ["Model", "型号"]) || generated.model;
  const amount = Number(item.quantity) * Number(item.unitPrice) * (1 - Number(item.discountPct) / 100);
  return {
    "${item.productName}": item.nameEn || item.nameZh || "",
    "${item.productNameEn}": item.nameEn || "",
    "${item.productNameZh}": item.nameZh || "",
    "${item.productCode}": fieldValue(fields, ["Product Code", "Code", "产品代码"]) || model || item.code || "",
    "${item.model}": model,
    "${item.modelLines}": fieldValue(fields, ["Model Lines"]) || generated.modelLines,
    "${item.orderCodeMeaning}": fieldValue(fields, ["Order Code Meaning", "订货号释义"]) || generated.meaning,
    "${item.currency}": currency,
    "${item.quantity}": String(item.quantity ?? ""),
    "${item.unitPrice}": formatNumber(item.unitPrice),
    "${item.discountPct}": String(item.discountPct ?? 0),
    "${item.amount}": formatNumber(amount)
  };
}

export function meta(fields: FieldRecord[], key: string) {
  return fields.find((field) => field.label === `__${key}`)?.value ?? "";
}

export function fieldValue(fields: FieldRecord[], labels: string[]) {
  const wanted = labels.map((label) => label.toLowerCase());
  return fields.find((field) => wanted.includes(String(field.label).trim().toLowerCase()))?.value ?? "";
}

export function generatedModel(fields: FieldRecord[]) {
  const raw = meta(fields, "modelRule");
  if (!raw) return { model: "", modelLines: "", meaning: "" };
  try {
    const rule = JSON.parse(raw);
    const segments = Array.isArray(rule.segments) ? rule.segments : [];
    const selected = segments.map((segment: any) => {
      const key = `modelSegment:${segment.id || segment.label}`;
      const code = meta(fields, key);
      const option = Array.isArray(segment.options)
        ? segment.options.find((item: any) => String(item.code) === code)
        : null;
      return { code, description: option?.description ?? "" };
    });
    const codes = selected.map((entry: any) => entry.code).join("");
    const prefix = meta(fields, "modelPrefix") || String(rule.prefixOptions?.[0]?.code ?? rule.prefix ?? "");
    const separator = String(rule.separator ?? "-");
    return {
      model: [prefix, codes].filter(Boolean).join(separator),
      modelLines: [
        prefix,
        prefix && codes ? separator : "",
        ...selected.map((entry: any) => entry.code).filter(Boolean)
      ]
        .filter((line) => line !== "")
        .join("\n"),
      meaning: selected
        .filter((entry: any) => entry.code)
        .map((entry: any) => `${entry.code}: ${entry.description}`)
        .join("\n")
    };
  } catch {
    return { model: "", modelLines: "", meaning: "" };
  }
}

export function currencyFormat(currency: string) {
  const symbol = currencySymbol(currency);
  return `"${symbol}"#,##0.00`;
}

function currencySymbol(currency: string) {
  return ({ USD: "US$", EUR: "EUR", CNY: "CNY", GBP: "GBP", AUD: "A$" } as Record<string, string>)[currency] ?? currency;
}

export function formatNumber(value: number | string | null | undefined) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Number(value || 0)
  );
}

export function replaceTokens(sheet: ExcelJS.Worksheet, tokens: Record<string, string>) {
  sheet.eachRow((row) =>
    row.eachCell((cell) => {
      // Skip slave cells of merged ranges; writing to them would break the merge,
      // leaving the master's value duplicated across every cell in the range.
      if (cell.isMerged && (cell as any).master && (cell as any).master !== cell) return;
      cell.value = replaceValue(cell.value, tokens) as any;
    })
  );
}

export function replaceValue(value: ExcelJS.CellValue, tokens: Record<string, string>): ExcelJS.CellValue {
  if (typeof value === "string") {
    return Object.entries(tokens).reduce(
      (text, [token, replacement]) => text.replaceAll(token, replacement),
      value
    );
  }
  if (value && typeof value === "object" && "richText" in value && Array.isArray(value.richText)) {
    return {
      ...value,
      richText: value.richText.map((part: any) => ({
        ...part,
        text: String(replaceValue(part.text, tokens) ?? "")
      }))
    } as ExcelJS.CellValue;
  }
  return value;
}
