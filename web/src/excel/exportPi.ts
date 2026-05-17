import ExcelJS from "exceljs";
import { api } from "../api/client";
import { parsePiItems } from "../pi/piItemCodec";
import {
  currencyFormat,
  ExportBundle,
  fieldTokens,
  fieldValue,
  generatedModel,
  itemTokens,
  meta,
  replaceTokens,
  replaceValue,
  tokensFor
} from "./tokens";

const TEMPLATE_FETCH_TIMEOUT_MS = 30000;

export async function exportPi(id: string) {
  const { data: raw } = await api.get<ExportBundle>(`/pi/${id}/export-bundle`);
  const data: ExportBundle = { ...raw, items: parsePiItems(raw.items) };
  const workbook = data.excelTemplateUrl
    ? await loadWorkbook(data.excelTemplateUrl, "PI header template")
    : new ExcelJS.Workbook();
  const sheet = workbook.worksheets[0] ?? workbook.addWorksheet("PI");
  if (!data.excelTemplateUrl) buildFallbackHeader(sheet, data);
  const printSettings = snapshotPrintSettings(sheet);

  const tokens = tokensFor(data);
  replaceTokens(sheet, tokens);
  await applyFieldPositions(sheet, data.pi.language, tokens);

  let rowNo = findAnchorRow(workbook, sheet, data.anchorCellName) || sheet.rowCount + 2;
  const startRow = rowNo;

  // Snapshot every merge in the main template at or below the splice point, then
  // unmerge them. ExcelJS's spliceRows does not reliably shift merge ranges, so
  // we restore them ourselves once we know the total inserted row count.
  const footerMerges = readMerges(sheet).filter((m) => m.r1 >= startRow);
  for (const m of footerMerges) {
    try {
      sheet.unMergeCells(`${colNumToLetter(m.c1)}${m.r1}:${colNumToLetter(m.c2)}${m.r2}`);
    } catch {
      /* ignore */
    }
  }

  const amountRows: number[] = [];
  for (const item of data.items) {
    rowNo = await writeLineItem(sheet, item, rowNo, data, amountRows);
  }
  if (data.pi.language === "EN" && amountRows.length > 0) writeTotalsRow(sheet, rowNo, data, amountRows);

  const insertedRows = rowNo - startRow;
  for (const m of footerMerges) {
    const range = `${colNumToLetter(m.c1)}${m.r1 + insertedRows}:${colNumToLetter(m.c2)}${m.r2 + insertedRows}`;
    try {
      sheet.mergeCells(range);
    } catch {
      /* ignore overlap */
    }
  }

  restorePrintSettings(sheet, printSettings);
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${data.pi.piNo}.xlsx`);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function writeLineItem(
  sheet: ExcelJS.Worksheet,
  item: any,
  rowNo: number,
  data: ExportBundle,
  amountRows: number[]
) {
  const fields = item.fieldValues;
  const subUrl = data.productTemplateUrls[item.productId];

  if (subUrl) {
    return appendSubTemplate(sheet, subUrl, item, fields, rowNo);
  }

  const template = snapshotRow(sheet.getRow(rowNo), Math.max(sheet.columnCount, 7));
  const values = { ...fieldTokens(fields), ...itemTokens(item, fields) };
  const currency = meta(fields, "currency") || "USD";
  const generated = generatedModel(fields);
  const productCode =
    fieldValue(fields, ["Product Code", "Code", "产品代码"]) || generated.model || item.code;
  const model = fieldValue(fields, ["Model", "型号"]) || generated.model;

  if (rowHasItemTokens(template)) {
    sheet.spliceRows(rowNo, 0, []);
    applyRowSnapshot(sheet.getRow(rowNo), template, values);
  } else if (data.pi.language === "EN") {
    sheet.spliceRows(rowNo, 0, [
      item.nameEn,
      productCode,
      model,
      Number(item.quantity),
      Number(item.unitPrice),
      Number(item.discountPct),
      { formula: `D${rowNo}*E${rowNo}*(1-F${rowNo}/100)` }
    ]);
    amountRows.push(rowNo);
    sheet.getCell(`E${rowNo}`).numFmt = currencyFormat(currency);
    sheet.getCell(`G${rowNo}`).numFmt = currencyFormat(currency);
  } else {
    sheet.spliceRows(rowNo, 0, [item.nameZh, productCode, model, Number(item.quantity)]);
  }
  if (!rowHasItemTokens(template)) applyRowSnapshot(sheet.getRow(rowNo), template);
  return rowNo + 1;
}

async function appendSubTemplate(
  sheet: ExcelJS.Worksheet,
  subUrl: string,
  item: any,
  fields: Array<{ label: string; value: string }>,
  startRow: number
) {
  const sub = await loadWorkbook(subUrl, `product sub-template for ${item.nameEn || item.nameZh || item.code}`);
  const src = sub.worksheets[0];
  const values = { ...fieldTokens(fields), ...itemTokens(item, fields) };

  const merges = readMerges(src);
  const slaveCells = new Set<string>();
  for (const m of merges) {
    for (let r = m.r1; r <= m.r2; r++) {
      for (let c = m.c1; c <= m.c2; c++) {
        if (r === m.r1 && c === m.c1) continue;
        slaveCells.add(`${r},${c}`);
      }
    }
  }

  for (let c = 1; c <= src.columnCount; c++) {
    const w = src.getColumn(c).width;
    if (w) sheet.getColumn(c).width = w;
  }

  const rowOffset = startRow - 1;
  for (let r = 1; r <= src.rowCount; r++) {
    const targetRow = startRow + (r - 1);
    const srcRow = src.getRow(r);
    const rowData: any[] = [];
    for (let c = 1; c <= src.columnCount; c++) {
      if (slaveCells.has(`${r},${c}`)) {
        rowData.push(null);
        continue;
      }
      const srcCell = srcRow.getCell(c);
      rowData.push(replaceValue(srcCell.value, values));
    }
    sheet.spliceRows(targetRow, 0, rowData);
    const dst = sheet.getRow(targetRow);
    if (srcRow.height) dst.height = srcRow.height;
    for (let c = 1; c <= src.columnCount; c++) {
      const srcCell = srcRow.getCell(c);
      const dstCell = dst.getCell(c);
      if (srcCell.style) dstCell.style = JSON.parse(JSON.stringify(srcCell.style));
    }
    dst.commit();
  }

  for (const m of merges) {
    const range = `${colNumToLetter(m.c1)}${m.r1 + rowOffset}:${colNumToLetter(m.c2)}${m.r2 + rowOffset}`;
    try {
      sheet.mergeCells(range);
    } catch {
      // ignore overlap errors
    }
  }

  return startRow + src.rowCount;
}

function readMerges(ws: ExcelJS.Worksheet): Array<{ r1: number; c1: number; r2: number; c2: number }> {
  const ranges = new Set<string>();
  const wsAny = ws as any;

  try {
    const modelMerges = wsAny.model?.merges;
    if (Array.isArray(modelMerges)) for (const r of modelMerges) ranges.add(String(r));
  } catch {
    /* ignore */
  }

  try {
    const m = wsAny._merges;
    if (m) {
      const candidates = m.merges ?? m._merges ?? m;
      if (candidates && typeof candidates === "object") {
        for (const v of Object.values(candidates)) {
          const range = (v as any)?.range ?? (v as any)?.shortRange;
          if (typeof range === "string") ranges.add(range);
        }
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const masters = new Map<string, { r1: number; c1: number; r2: number; c2: number }>();
    const rc = ws.rowCount;
    const cc = ws.columnCount;
    for (let r = 1; r <= rc; r++) {
      for (let c = 1; c <= cc; c++) {
        const cell = ws.getCell(r, c);
        if (!cell.isMerged) continue;
        const master = (cell as any).master;
        if (!master) continue;
        const addr = String(master.address ?? master._address ?? "");
        const parsed = parseAddress(addr);
        if (!parsed) continue;
        const key = `${parsed.row},${parsed.col}`;
        const existing = masters.get(key);
        if (existing) {
          existing.r1 = Math.min(existing.r1, parsed.row, r);
          existing.r2 = Math.max(existing.r2, parsed.row, r);
          existing.c1 = Math.min(existing.c1, parsed.col, c);
          existing.c2 = Math.max(existing.c2, parsed.col, c);
        } else {
          masters.set(key, {
            r1: Math.min(parsed.row, r),
            c1: Math.min(parsed.col, c),
            r2: Math.max(parsed.row, r),
            c2: Math.max(parsed.col, c)
          });
        }
      }
    }
    for (const m of masters.values()) {
      ranges.add(`${colNumToLetter(m.c1)}${m.r1}:${colNumToLetter(m.c2)}${m.r2}`);
    }
  } catch {
    /* ignore */
  }

  const out: Array<{ r1: number; c1: number; r2: number; c2: number }> = [];
  const seen = new Set<string>();
  for (const range of ranges) {
    const cleaned = String(range).replace(/\$/g, "");
    const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i.exec(cleaned);
    if (!m) continue;
    const rec = {
      c1: colLetterToNum(m[1]),
      r1: Number(m[2]),
      c2: colLetterToNum(m[3]),
      r2: Number(m[4])
    };
    const key = `${rec.r1},${rec.c1},${rec.r2},${rec.c2}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rec);
  }
  return out;
}

function parseAddress(addr: string): { row: number; col: number } | null {
  const m = /^([A-Z]+)(\d+)$/i.exec(addr);
  if (!m) return null;
  return { col: colLetterToNum(m[1]), row: Number(m[2]) };
}

function colLetterToNum(letter: string): number {
  let result = 0;
  const upper = letter.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    result = result * 26 + (upper.charCodeAt(i) - 64);
  }
  return result;
}

function colNumToLetter(num: number): string {
  let s = "";
  let n = num;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

type RowSnapshot = {
  height?: number;
  cells: Array<{ value: ExcelJS.CellValue; style: Partial<ExcelJS.Style> }>;
};

function snapshotRow(row: ExcelJS.Row, columnCount: number): RowSnapshot {
  return {
    height: row.height,
    cells: Array.from({ length: columnCount }, (_, index) => {
      const cell = row.getCell(index + 1);
      return {
        value: cell.value,
        style: JSON.parse(JSON.stringify(cell.style ?? {}))
      };
    })
  };
}

function rowHasItemTokens(row: RowSnapshot): boolean {
  return row.cells.some((cell) => typeof cell.value === "string" && /\$\{(?:item|field)\./.test(cell.value));
}

function applyRowSnapshot(
  row: ExcelJS.Row,
  snapshot: RowSnapshot,
  values: Record<string, string> = {}
) {
  if (snapshot.height) row.height = snapshot.height;
  snapshot.cells.forEach((cell, index) => {
    const target = row.getCell(index + 1);
    target.style = JSON.parse(JSON.stringify(cell.style ?? {}));
    if (Object.keys(values).length > 0) {
      target.value = replaceValue(cell.value, values) as any;
    }
  });
  row.commit();
}

function snapshotPrintSettings(sheet: ExcelJS.Worksheet) {
  return {
    headerFooter: JSON.parse(JSON.stringify((sheet as any).headerFooter ?? {})),
    pageSetup: JSON.parse(JSON.stringify((sheet as any).pageSetup ?? {})),
    pageMargins: JSON.parse(JSON.stringify((sheet as any).pageMargins ?? {})),
    views: JSON.parse(JSON.stringify((sheet as any).views ?? [])),
    properties: JSON.parse(JSON.stringify((sheet as any).properties ?? {}))
  };
}

function restorePrintSettings(sheet: ExcelJS.Worksheet, settings: ReturnType<typeof snapshotPrintSettings>) {
  (sheet as any).headerFooter = removeUnsupportedHeaderFooterPictures(settings.headerFooter);
  (sheet as any).pageSetup = settings.pageSetup;
  (sheet as any).pageMargins = settings.pageMargins;
  (sheet as any).views = settings.views;
  (sheet as any).properties = settings.properties;
}

function removeUnsupportedHeaderFooterPictures(headerFooter: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(headerFooter).map(([key, value]) => [
      key,
      typeof value === "string" ? value.replace(/&G/g, "") : value
    ])
  );
}

function writeTotalsRow(
  sheet: ExcelJS.Worksheet,
  rowNo: number,
  data: ExportBundle,
  amountRows: number[]
) {
  const totalRow = rowNo + 1;
  const firstFields = data.items[0]?.fieldValues ?? [];
  const currency = meta(firstFields, "currency") || "USD";
  sheet.getCell(`F${totalRow}`).value = "Total";
  sheet.getCell(`G${totalRow}`).value = {
    formula: amountRows.length ? `SUM(${amountRows.map((r) => `G${r}`).join(",")})` : "0"
  };
  sheet.getCell(`G${totalRow}`).numFmt = currencyFormat(currency);
}

async function applyFieldPositions(
  sheet: ExcelJS.Worksheet,
  language: "EN" | "ZH",
  tokens: Record<string, string>
) {
  const res = await api.get(`/options/piFieldPositions${language}`);
  for (const row of res.data as Array<{ value: string }>) {
    const [key, cell] = String(row.value).split("=");
    if (!key || !cell) continue;
    const value = tokens[`\${${key}}`];
    if (value !== undefined) sheet.getCell(cell).value = value;
  }
}

async function loadWorkbook(url: string, label: string) {
  const absolute = url.startsWith("/api") ? url : `/api${url}`;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), TEMPLATE_FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(absolute, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token") ?? ""}` },
      signal: controller.signal
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(`${label} took too long to load. Please re-upload the .xlsx template and try again.`);
    }
    throw new Error(`${label} could not be loaded. Please check that the uploaded file is a valid .xlsx template.`);
  } finally {
    window.clearTimeout(timeout);
  }
  if (!res.ok) throw new Error(`${label} could not be fetched (${res.status}). Please re-upload the .xlsx template.`);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await res.arrayBuffer());
  } catch {
    throw new Error(`${label} is not a valid .xlsx workbook. Please re-upload an Excel .xlsx file.`);
  }
  return wb;
}

function buildFallbackHeader(sheet: ExcelJS.Worksheet, data: ExportBundle) {
  sheet.addRow(["PI No", data.pi.piNo]);
  sheet.addRow(["Date", data.pi.date]);
  sheet.addRow(["Customer", data.pi.customerCompany]);
  sheet.addRow(["Other Requirements", data.pi.otherRequirements]);
  sheet.addRow([]);
  sheet.addRow(
    data.pi.language === "EN"
      ? ["Product Name", "Code", "Model", "Qty", "Unit Price", "Discount %", "Amount"]
      : ["Product Name", "Code", "Model", "Qty"]
  );
}

function findAnchorRow(workbook: ExcelJS.Workbook, sheet: ExcelJS.Worksheet, name: string) {
  const ranges = workbook.definedNames.getRanges(name);
  const first = ranges?.ranges?.[0];
  const match = first?.match(/\$[A-Z]+\$(\d+)/i);
  if (match) return Number(match[1]);
  let found = 0;
  sheet.eachRow((row, rowNumber) =>
    row.eachCell((cell) => {
      if (cell.value === "${PRODUCTS_START}") {
        cell.value = "";
        found = rowNumber;
      }
    })
  );
  return found;
}
