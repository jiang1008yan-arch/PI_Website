import { all, first, id } from "./db";
import { applyDeviceEvent, isOfflineAlertDue, type DeviceEvent, type DeviceRow } from "./deviceAlerts";
import { deviceAlertCard, type DeviceAlertData } from "./feishu/cards";
import { feishuEnabled, sendCard } from "./feishu/client";
import type { Env } from "./types";

// Device status pushed by the charger backend: every event is logged, the
// latest state per SN kept, and alerts raised in the after-sales group as a
// card with "创建工单" — whoever presses it creates (and owns) the ticket,
// through the same request/form flow as a chat message.

const sqlTime = (date: Date) => date.toISOString().slice(0, 19).replace("T", " ");

// What the system knows about an SN: the approved PI it is registered on.
async function deviceContext(db: D1Database, serialNumber: string) {
  return await first<{ piNo: string; productionOrderNo: string; customerCompany: string }>(
    db,
    `SELECT pi.piNo,
            TRIM(COALESCE(json_extract(pi.effectiveSnapshot, '$.zh.header.productionOrderNo'), pi.productionOrderNo, '')) AS productionOrderNo,
            TRIM(COALESCE(json_extract(pi.effectiveSnapshot, '$.zh.header.customerCompany'), pi.customerCompany, '')) AS customerCompany
     FROM devices d JOIN pi ON pi.id = d.piId WHERE d.serialNumber = ?`,
    serialNumber
  );
}

async function raiseAlert(env: Env, row: DeviceRow, kind: "FAULT" | "OFFLINE", now: Date) {
  if (!feishuEnabled(env)) return;
  const ctx = await deviceContext(env.DB, row.serialNumber);
  const data: DeviceAlertData = {
    draftId: id("fdr"),
    serialNumber: row.serialNumber,
    kind,
    faultCode: row.faultCode,
    faultText: row.faultText,
    since: kind === "OFFLINE" ? row.offlineSince : row.alertOpenedAt,
    registered: Boolean(ctx),
    customerCompany: ctx?.customerCompany ?? null,
    productionOrderNo: ctx?.productionOrderNo ?? null,
    piNo: ctx?.piNo ?? null
  };
  const text =
    kind === "FAULT"
      ? `设备告警：SN ${row.serialNumber} 故障${row.faultCode ? ` ${row.faultCode}` : ""}${row.faultText ? `（${row.faultText}）` : ""}`
      : `设备告警：SN ${row.serialNumber} 离线超过 2 小时（自 ${row.offlineSince} UTC）`;
  // Requested by nobody yet; no source chat, so no customer receipt is sent.
  await env.DB.prepare(
    "INSERT INTO feishuDrafts (id, requestedByOpenId, sourceChatId, sourceMessageId, text, kind, serialNumber) VALUES (?, '', '', '', ?, 'DEVICE_ALERT', ?)"
  )
    .bind(data.draftId, text, row.serialNumber)
    .run();
  const messageId = await sendCard(env, "chat_id", env.FEISHU_SERVICE_CHAT_ID!, deviceAlertCard(data));
  await env.DB.batch([
    env.DB.prepare("UPDATE feishuDrafts SET cardMessageId = ? WHERE id = ?").bind(messageId || null, data.draftId),
    env.DB.prepare("UPDATE deviceStatus SET alertDraftId = ?, updatedAt = ? WHERE serialNumber = ?").bind(data.draftId, sqlTime(now), row.serialNumber)
  ]);
}

async function saveState(db: D1Database, row: DeviceRow, now: Date, resetAlert: boolean) {
  await db
    .prepare(
      `INSERT INTO deviceStatus (serialNumber, status, faultCode, faultText, lastEventAt, offlineSince, alertKind, alertOpenedAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(serialNumber) DO UPDATE SET status = excluded.status, faultCode = excluded.faultCode, faultText = excluded.faultText,
         lastEventAt = excluded.lastEventAt, offlineSince = excluded.offlineSince, alertKind = excluded.alertKind,
         alertOpenedAt = excluded.alertOpenedAt, updatedAt = excluded.updatedAt
         ${resetAlert ? ", alertDraftId = NULL, alertTicketId = NULL" : ""}`
    )
    .bind(row.serialNumber, row.status, row.faultCode, row.faultText, row.lastEventAt, row.offlineSince, row.alertKind, row.alertOpenedAt, sqlTime(now))
    .run();
}

export async function ingestDeviceEvents(env: Env, events: DeviceEvent[], now: Date): Promise<{ alerts: number }> {
  let alerts = 0;
  // Oldest first, so each SN's state follows the events in order.
  const ordered = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  for (const ev of ordered) {
    await env.DB.prepare("INSERT INTO deviceEvents (id, serialNumber, status, faultCode, faultText, occurredAt) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id("dev"), ev.serialNumber, ev.status, ev.faultCode, ev.faultText, ev.occurredAt)
      .run();
    const prev = await first<DeviceRow>(env.DB, "SELECT * FROM deviceStatus WHERE serialNumber = ?", ev.serialNumber);
    const result = applyDeviceEvent(prev, ev);
    if (!result) continue;
    await saveState(env.DB, result.next, now, result.closed || Boolean(result.open));
    if (result.open) {
      await raiseAlert(env, result.next, result.open, now);
      alerts++;
    }
  }
  return { alerts };
}

// Scheduled: devices offline for too long get an alert.
export async function checkOfflineDevices(env: Env, now: Date): Promise<number> {
  const rows = await all<DeviceRow>(env.DB, "SELECT * FROM deviceStatus WHERE status = 'OFFLINE' AND alertKind IS NULL AND offlineSince IS NOT NULL");
  let raised = 0;
  for (const row of rows.filter((r) => isOfflineAlertDue(r, now))) {
    const next: DeviceRow = { ...row, alertKind: "OFFLINE", alertOpenedAt: sqlTime(now) };
    await saveState(env.DB, next, now, true);
    await raiseAlert(env, next, "OFFLINE", now);
    raised++;
  }
  return raised;
}

// For the Device monitoring tab: open alerts and the latest events.
export async function deviceMonitorView(db: D1Database) {
  const [alerts, events] = await Promise.all([
    all(
      db,
      `SELECT s.serialNumber, s.status, s.faultCode, s.faultText, s.alertKind, s.alertOpenedAt, s.offlineSince, s.lastEventAt, s.alertTicketId,
              t.ticketNo AS alertTicketNo,
              TRIM(COALESCE(json_extract(pi.effectiveSnapshot, '$.zh.header.customerCompany'), pi.customerCompany, '')) AS customerCompany,
              TRIM(COALESCE(json_extract(pi.effectiveSnapshot, '$.zh.header.productionOrderNo'), pi.productionOrderNo, '')) AS productionOrderNo
       FROM deviceStatus s
       LEFT JOIN devices d ON d.serialNumber = s.serialNumber
       LEFT JOIN pi ON pi.id = d.piId
       LEFT JOIN tickets t ON t.id = s.alertTicketId
       WHERE s.alertKind IS NOT NULL
       ORDER BY s.alertOpenedAt DESC`
    ),
    all(db, "SELECT serialNumber, status, faultCode, faultText, occurredAt FROM deviceEvents ORDER BY occurredAt DESC, rowid DESC LIMIT 50")
  ]);
  return { alerts, events };
}
