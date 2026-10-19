import { all, first, id } from "./db";
import { canAssignServiceSide, canChangeStatus, canConfirmFault, canWriteNote, isValidTransition, type TicketStatus } from "./ticketAccess";
import { validateAnswers, type TicketFieldRow } from "./ticketAnswers";
import { nextTicketNumber } from "./ticketNumber";
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
  answers?: unknown;
  assignedSalesId?: string | null;
  assignedServiceId?: string | null;
  feishuSourceChatId?: string | null;
  feishuSourceMessageId?: string | null;
  // A first timeline note written with the ticket (e.g. the quoted customer message).
  initialNote?: { actorId: string; text: string } | null;
};

export async function createTicket(env: Env, input: NewTicket, opts: { requireProduct: boolean; validateQuestionnaire: boolean }) {
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

  const date = new Date().toISOString().slice(0, 10);
  const { seq, ticketNo } = await nextTicketNumber(env, date);
  const ticketId = id("tkt");
  await db
    .prepare(
      `INSERT INTO tickets (id, ticketNo, seq, status, customerCompany, orderNo, contactName, contactInfo, productId, answers,
                            assignedSalesId, assignedServiceId, linkId, feishuSourceChatId, feishuSourceMessageId)
       VALUES (?, ?, ?, 'NEW', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
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
      input.assignedSalesId || null,
      input.assignedServiceId || null,
      input.feishuSourceChatId || null,
      input.feishuSourceMessageId || null
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
  const ticket = await first<{ id: string; status: TicketStatus }>(db, "SELECT id, status FROM tickets WHERE id=?", ticketId);
  if (!ticket) throw new TicketError("Not found", 404);
  if (!isValidTransition(ticket.status, to)) throw new TicketError(`Cannot move from ${ticket.status} to ${to}`, 400);
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
  await db.prepare("UPDATE tickets SET assignedServiceId=?, updatedAt=CURRENT_TIMESTAMP WHERE id=?").bind(user.id, ticket.id).run();
  if (ticket.status === "NEW") await changeTicketStatus(db, user, ticket.id, "IN_PROGRESS");
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
      .prepare("UPDATE tickets SET faultType=?, faultConfirmedById=?, faultConfirmedAt=CURRENT_TIMESTAMP, updatedAt=CURRENT_TIMESTAMP WHERE id=?")
      .bind(faultType, user.id, ticket.id),
    db
      .prepare("INSERT INTO ticketUpdates (id, ticketId, actorId, kind, note) VALUES (?, ?, ?, 'NOTE', ?)")
      .bind(id("tup"), ticket.id, user.id, `Fault type confirmed: ${faultType}`)
  ]);
  return { productId: ticket.productId, faultType };
}
