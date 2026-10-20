import { all, first, id } from "./db";
import { TICKET_TYPES, type TicketType } from "./aiTriage";
import { canAssignSalesSide, canAssignServiceSide, canChangeStatus, canConfirmFault, canWriteNote, isValidTransition, type TicketStatus } from "./ticketAccess";
import { validateAnswers, type TicketFieldRow } from "./ticketAnswers";
import { nextTicketNumber } from "./ticketNumber";
import { normalizeSerial } from "./devices";
import type { AppUser, Env } from "./types";

// Ticket operations shared by the web routes and the Feishu bot, so both
// surfaces apply the same permission and transition rules and write the same
// timeline. Each throws TicketError for a refusal the caller turns into a
// response (HTTP status on the web, a toast in Feishu).

export class TicketError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404) {
    super(message);
  }
}

export const FAULT_TYPE_OPTION_KEY = "faultType";

export type NewTicket = {
  customerCompany?: string;
  orderNo?: string;
  contactName: string;
  contactInfo: string;
  productId?: string | null;
  // The concrete model (from the PI's product line) and device SN, when known.
  productModel?: string | null;
  serialNumber?: string | null;
  answers?: unknown;
  assignedSalesId?: string | null;
  assignedServiceId?: string | null;
  feishuSourceChatId?: string | null;
  feishuSourceMessageId?: string | null;
  // A first timeline note written with the ticket (e.g. the quoted customer message).
  initialNote?: { actorId: string; text: string } | null;
  summary?: string | null;
};

export const TICKET_TYPE_TEXT: Record<TicketType, string> = { FAULT: "Fault", PRODUCT_REQUEST: "Product request", OTHER: "Question / other" };

// Whoever creates a ticket owns it: after-sales and admins become its
// after-sales owner, sales its sales owner, unless someone else was named.
export function ownersForCreator(creator: AppUser | null | undefined, input: Pick<NewTicket, "assignedSalesId" | "assignedServiceId">) {
  let assignedSalesId = input.assignedSalesId || null;
  let assignedServiceId = input.assignedServiceId || null;
  if (creator && canAssignServiceSide(creator) && !assignedServiceId) assignedServiceId = creator.id;
  else if (creator?.role === "SALES" && !assignedSalesId) assignedSalesId = creator.id;
  return { assignedSalesId, assignedServiceId };
}

export async function createTicket(
  env: Env,
  input: NewTicket,
  opts: { requireProduct: boolean; validateQuestionnaire: boolean; creator?: AppUser | null }
) {
  const db = env.DB;
  const customerCompany = String(input.customerCompany ?? "").trim().slice(0, 200);
  const orderNo = String(input.orderNo ?? "").trim().slice(0, 100);
  const contactName = String(input.contactName ?? "").trim();
  const contactInfo = String(input.contactInfo ?? "").trim();
  if (!contactName || contactName.length > 200) throw new TicketError("A valid contact name is required.", 400);
  if (!contactInfo || contactInfo.length > 200) throw new TicketError("Valid contact details are required.", 400);

  const product = input.productId
    ? await first<{ id: string }>(db, "SELECT id FROM products WHERE id=? AND status='ACTIVE'", String(input.productId))
    : null;
  if (opts.requireProduct && !product) throw new TicketError("A valid product is required.", 400);

  let answers: Record<string, string> = {};
  if (opts.validateQuestionnaire) {
    const fields = await all<TicketFieldRow>(db, "SELECT id, label, fieldType, options, required FROM ticketFields ORDER BY sortOrder, label");
    const validated = validateAnswers(fields, input.answers);
    if (!validated.ok) throw new TicketError(validated.error, 400);
    answers = validated.answers;
  }

  const owners = ownersForCreator(opts.creator, input);
  const date = new Date().toISOString().slice(0, 10);
  const { seq, ticketNo } = await nextTicketNumber(env, date);
  const ticketId = id("tkt");
  await db
    .prepare(
      `INSERT INTO tickets (id, ticketNo, seq, status, customerCompany, orderNo, contactName, contactInfo, productId, answers,
                            assignedSalesId, assignedServiceId, linkId, feishuSourceChatId, feishuSourceMessageId, summary,
                            productModel, serialNumber)
       VALUES (?, ?, ?, 'NEW', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`
    )
    .bind(
      ticketId,
      ticketNo,
      seq,
      customerCompany,
      orderNo,
      contactName,
      contactInfo,
      product?.id ?? null,
      JSON.stringify(answers),
      owners.assignedSalesId,
      owners.assignedServiceId,
      input.feishuSourceChatId || null,
      input.feishuSourceMessageId || null,
      String(input.summary ?? "").trim().slice(0, 300) || null,
      String(input.productModel ?? "").trim().slice(0, 300) || null,
      normalizeSerial(input.serialNumber).slice(0, 64) || null
    )
    .run();
  if (input.initialNote?.text.trim()) {
    await db
      .prepare("INSERT INTO ticketUpdates (id, ticketId, actorId, kind, note) VALUES (?, ?, ?, 'NOTE', ?)")
      .bind(id("tup"), ticketId, input.initialNote.actorId, input.initialNote.text.trim().slice(0, 4000))
      .run();
  }
  return { id: ticketId, ticketNo };
}

export async function changeTicketStatus(db: D1Database, user: AppUser, ticketId: string, to: TicketStatus) {
  if (!canChangeStatus(user)) throw new TicketError("Forbidden", 403);
  const ticket = await first<{ id: string; status: TicketStatus; ticketType: TicketType | null; faultType: string | null }>(
    db,
    "SELECT id, status, ticketType, faultType FROM tickets WHERE id=?",
    ticketId
  );
  if (!ticket) throw new TicketError("Not found", 404);
  if (!isValidTransition(ticket.status, to)) throw new TicketError(`Cannot move from ${ticket.status} to ${to}`, 400);
  // Statistics depend on every resolved ticket being classified.
  if (to === "RESOLVED" && !ticket.ticketType) throw new TicketError("Choose the ticket type before resolving it.", 400);
  if (to === "RESOLVED" && ticket.ticketType === "FAULT" && !ticket.faultType) throw new TicketError("Confirm the fault type before resolving it.", 400);
  await db.batch([
    db.prepare("UPDATE tickets SET status=?, updatedAt=CURRENT_TIMESTAMP WHERE id=?").bind(to, ticket.id),
    db
      .prepare("INSERT INTO ticketUpdates (id, ticketId, actorId, kind, statusFrom, statusTo) VALUES (?, ?, ?, 'STATUS', ?, ?)")
      .bind(id("tup"), ticket.id, user.id, ticket.status, to)
  ]);
  return { from: ticket.status, to };
}

export async function addTicketNote(db: D1Database, user: AppUser, ticketId: string, rawNote: string) {
  if (!canWriteNote(user)) throw new TicketError("Forbidden", 403);
  const note = String(rawNote ?? "").trim();
  if (!note) throw new TicketError("Note is required", 400);
  const ticket = await first<{ id: string }>(db, "SELECT id FROM tickets WHERE id=?", ticketId);
  if (!ticket) throw new TicketError("Not found", 404);
  await db.batch([
    db.prepare("INSERT INTO ticketUpdates (id, ticketId, actorId, kind, note) VALUES (?, ?, ?, 'NOTE', ?)").bind(id("tup"), ticket.id, user.id, note.slice(0, 4000)),
    db.prepare("UPDATE tickets SET updatedAt=CURRENT_TIMESTAMP WHERE id=?").bind(ticket.id)
  ]);
}

// "Take" a ticket: become its after-sales owner and start work on it.
export async function takeTicket(db: D1Database, user: AppUser, ticketId: string) {
  if (!canAssignServiceSide(user) || !canChangeStatus(user)) throw new TicketError("Forbidden", 403);
  const ticket = await first<{ id: string; status: TicketStatus }>(db, "SELECT id, status FROM tickets WHERE id=?", ticketId);
  if (!ticket) throw new TicketError("Not found", 404);
  await assignTicket(db, user, ticket.id, { assignedServiceId: user.id });
  if (ticket.status === "NEW") await changeTicketStatus(db, user, ticket.id, "IN_PROGRESS");
}

// Change who is responsible. After-sales/admins set the after-sales owner,
// sales/admins the sales owner. Every change is written to the timeline.
// Returns the new owners, if any, so they can be notified.
export async function assignTicket(
  db: D1Database,
  user: AppUser,
  ticketId: string,
  d: { assignedSalesId?: string | null; assignedServiceId?: string | null }
): Promise<{ changed: boolean; newServiceOwnerId: string | null; newSalesOwnerId: string | null }> {
  const ticket = await first<{ id: string; assignedSalesId: string | null; assignedServiceId: string | null }>(
    db,
    "SELECT id, assignedSalesId, assignedServiceId FROM tickets WHERE id=?",
    ticketId
  );
  if (!ticket) throw new TicketError("Not found", 404);
  // Sides the user may not set are ignored, as before.
  const setService = d.assignedServiceId !== undefined && canAssignServiceSide(user);
  const setSales = d.assignedSalesId !== undefined && canAssignSalesSide(user);
  if (!setService && !setSales) throw new TicketError("Nothing to update", 400);
  const changes: { column: "assignedSalesId" | "assignedServiceId"; label: string; from: string | null; to: string | null }[] = [];
  if (setService && (d.assignedServiceId || null) !== ticket.assignedServiceId) {
    changes.push({ column: "assignedServiceId", label: "After-sales owner", from: ticket.assignedServiceId, to: d.assignedServiceId || null });
  }
  if (setSales && (d.assignedSalesId || null) !== ticket.assignedSalesId) {
    changes.push({ column: "assignedSalesId", label: "Sales owner", from: ticket.assignedSalesId, to: d.assignedSalesId || null });
  }
  if (!changes.length) return { changed: false, newServiceOwnerId: null, newSalesOwnerId: null };

  const ids = [...new Set(changes.flatMap((ch) => [ch.from, ch.to]).filter((v): v is string => Boolean(v)))];
  const names = new Map(
    ids.length
      ? (await all<{ id: string; displayName: string }>(db, `SELECT id, displayName FROM users WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids)).map((u) => [u.id, u.displayName])
      : []
  );
  for (const ch of changes) {
    if (ch.to && !names.has(ch.to)) throw new TicketError("Unknown user.", 400);
  }
  const name = (v: string | null) => (v ? names.get(v) ?? "unknown" : "(none)");
  await db.batch([
    db.prepare(`UPDATE tickets SET ${changes.map((ch) => `${ch.column}=?`).join(", ")}, updatedAt=CURRENT_TIMESTAMP WHERE id=?`).bind(...changes.map((ch) => ch.to), ticket.id),
    ...changes.map((ch) =>
      db
        .prepare("INSERT INTO ticketUpdates (id, ticketId, actorId, kind, note) VALUES (?, ?, ?, 'NOTE', ?)")
        .bind(id("tup"), ticket.id, user.id, `${ch.label}: ${name(ch.from)} → ${name(ch.to)} (changed by ${user.displayName})`)
    )
  ]);
  return {
    changed: true,
    newServiceOwnerId: changes.find((ch) => ch.column === "assignedServiceId")?.to ?? null,
    newSalesOwnerId: changes.find((ch) => ch.column === "assignedSalesId")?.to ?? null
  };
}

// Correct the customer and production order number (e.g. picked from the
// lookup). After-sales/admin; each change is written to the timeline.
export async function setTicketCustomer(db: D1Database, user: AppUser, ticketId: string, d: { customerCompany?: unknown; orderNo?: unknown }) {
  if (!canConfirmFault(user)) throw new TicketError("Forbidden", 403);
  const ticket = await first<{ id: string; customerCompany: string; orderNo: string }>(db, "SELECT id, customerCompany, orderNo FROM tickets WHERE id=?", ticketId);
  if (!ticket) throw new TicketError("Not found", 404);
  const customerCompany = d.customerCompany === undefined ? ticket.customerCompany : String(d.customerCompany ?? "").trim().slice(0, 200);
  const orderNo = d.orderNo === undefined ? ticket.orderNo : String(d.orderNo ?? "").trim().slice(0, 100);
  const notes: string[] = [];
  if (customerCompany !== ticket.customerCompany) notes.push(`Customer: ${ticket.customerCompany || "(none)"} → ${customerCompany || "(none)"}`);
  if (orderNo !== ticket.orderNo) notes.push(`Production order no.: ${ticket.orderNo || "(none)"} → ${orderNo || "(none)"}`);
  if (!notes.length) return false;
  await db.batch([
    db.prepare("UPDATE tickets SET customerCompany=?, orderNo=?, updatedAt=CURRENT_TIMESTAMP WHERE id=?").bind(customerCompany, orderNo, ticket.id),
    ...notes.map((note) => db.prepare("INSERT INTO ticketUpdates (id, ticketId, actorId, kind, note) VALUES (?, ?, ?, 'NOTE', ?)").bind(id("tup"), ticket.id, user.id, note))
  ]);
  return true;
}

// Classify the ticket. Only faults keep a fault type; a one-line summary may
// be set at the same time. Returns whether it just became a product request.
export async function setTicketType(
  db: D1Database,
  user: AppUser,
  ticketId: string,
  d: { ticketType?: unknown; summary?: unknown }
): Promise<{ ticketType: TicketType; becameProductRequest: boolean }> {
  if (!canConfirmFault(user)) throw new TicketError("Forbidden", 403);
  const ticketType = TICKET_TYPES.find((t) => t === d.ticketType);
  if (!ticketType) throw new TicketError("Choose a ticket type.", 400);
  const ticket = await first<{ id: string; ticketType: TicketType | null; summary: string | null }>(db, "SELECT id, ticketType, summary FROM tickets WHERE id=?", ticketId);
  if (!ticket) throw new TicketError("Not found", 404);
  const summary = d.summary === undefined ? ticket.summary : String(d.summary ?? "").trim().slice(0, 300) || null;
  const statements = [
    db
      .prepare(
        `UPDATE tickets SET ticketType=?, summary=?,
           faultType = CASE WHEN ? = 'FAULT' THEN faultType ELSE NULL END,
           faultConfirmedById = CASE WHEN ? = 'FAULT' THEN faultConfirmedById ELSE NULL END,
           faultConfirmedAt = CASE WHEN ? = 'FAULT' THEN faultConfirmedAt ELSE NULL END,
           updatedAt=CURRENT_TIMESTAMP WHERE id=?`
      )
      .bind(ticketType, summary, ticketType, ticketType, ticketType, ticket.id)
  ];
  if (ticketType !== ticket.ticketType) {
    statements.push(
      db
        .prepare("INSERT INTO ticketUpdates (id, ticketId, actorId, kind, note) VALUES (?, ?, ?, 'NOTE', ?)")
        .bind(id("tup"), ticket.id, user.id, `Ticket type: ${TICKET_TYPE_TEXT[ticketType]}`)
    );
  }
  await db.batch(statements);
  return { ticketType, becameProductRequest: ticketType === "PRODUCT_REQUEST" && ticket.ticketType !== "PRODUCT_REQUEST" };
}

export async function confirmTicketFault(db: D1Database, user: AppUser, ticketId: string, rawFaultType: string) {
  if (!canConfirmFault(user)) throw new TicketError("Forbidden", 403);
  const faultType = String(rawFaultType ?? "").trim();
  const ticket = await first<{ id: string; productId: string | null }>(db, "SELECT id, productId FROM tickets WHERE id=?", ticketId);
  if (!ticket) throw new TicketError("Not found", 404);
  const allowed = await all<{ value: string }>(db, "SELECT value FROM appOptions WHERE optionKey = ?", FAULT_TYPE_OPTION_KEY);
  if (!allowed.some((o) => o.value === faultType)) throw new TicketError("Choose a fault type from the list.", 400);
  await db.batch([
    db
      .prepare("UPDATE tickets SET faultType=?, ticketType='FAULT', faultConfirmedById=?, faultConfirmedAt=CURRENT_TIMESTAMP, updatedAt=CURRENT_TIMESTAMP WHERE id=?")
      .bind(faultType, user.id, ticket.id),
    db
      .prepare("INSERT INTO ticketUpdates (id, ticketId, actorId, kind, note) VALUES (?, ?, ?, 'NOTE', ?)")
      .bind(id("tup"), ticket.id, user.id, `Fault type confirmed: ${faultType}`)
  ]);
  return { productId: ticket.productId, faultType };
}
