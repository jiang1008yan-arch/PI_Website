import { all, first, id } from "./db";
import { resolveBlocker, TICKET_TYPE_LABEL, TICKET_TYPES, type TicketType } from "../../shared/ticketCapabilities";
import { canAssignSalesSide, canAssignServiceSide, canChangeStatus, canConfirmFault, canWriteNote, isValidTransition, type TicketStatus } from "./ticketAccess";
import { nextTicketNumber } from "./ticketNumber";
import { isKnownSerial, normalizeSerial } from "./devices";
import { repeatInfo } from "./faultStats";
import type { AppUser, Env } from "./types";

// The Ticket workflow (CONTEXT.md): every ticket change, from the web routes
// and the Feishu bot alike, so both surfaces apply the same permission and
// transition rules and write the same timeline. The only writer of a ticket's
// business columns and of ticketUpdates. Each change commits one D1 batch and
// returns the TicketChanges it caused, which the caller hands to Feishu sync
// as they are. Each throws TicketError for a refusal the caller turns into a
// response (HTTP status on the web, a toast in Feishu).

export class TicketError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409) {
    super(message);
  }
}

// Commits one change. A guarded batch is rolled back by workflowGuard when what
// it was read with no longer holds: the ticket's status (someone else moved it
// first, website and Feishu card at once), or the claim on a Feishu request.
async function commit(db: D1Database, statements: D1PreparedStatement[], conflict = "This ticket was already changed by someone else. Refresh to see its latest state.") {
  if (!statements.length) return;
  try {
    await db.batch(statements);
  } catch (error) {
    if (/CHECK constraint failed: ok = 1/.test(String((error as Error)?.message))) throw new TicketError(conflict, 409);
    throw error;
  }
}

// A Feishu ticket request (or Add to ticket) claimed for this change
// (feishu/ticketRequest.ts). It is linked to the ticket in the same batch, and
// only while the claim is still this one, so a request is never left claimed
// with its ticket made, nor turned into two tickets.
export type RequestClaim = { requestId: string; claimedAt: string };

function requestLinkStatements(db: D1Database, claim: RequestClaim, ticketId: string) {
  return [
    db
      .prepare("UPDATE feishuDrafts SET ticketId = ?, claimedAt = NULL WHERE id = ? AND ticketId = 'CREATING' AND claimedAt = ?")
      .bind(ticketId, claim.requestId, claim.claimedAt),
    db.prepare("INSERT INTO workflowGuard (ok) VALUES (changes())"),
    db.prepare("DELETE FROM workflowGuard")
  ];
}

export const FAULT_TYPE_OPTION_KEY = "faultType";

// What changed on a ticket, for Feishu sync (functions/lib/feishu/sync.ts).
export type TicketChange =
  | { kind: "created" }
  | { kind: "status"; to: string }
  | { kind: "note" }
  | { kind: "taken" }
  | { kind: "product" }
  | { kind: "fault"; repeat: { count: number; windowDays: number } | null }
  // Product and fault type became known together some other way than
  // confirming the fault (a Feishu ticket created with its fault type, or a
  // product set on a ticket whose fault was confirmed), making a repeat fault.
  | { kind: "repeat"; repeat: { count: number; windowDays: number } }
  | { kind: "type"; ticketType: string; toPool: boolean }
  | { kind: "assigned"; newOwnerIds: string[] };

// A file already in R2 (material collected in Feishu), attached as it is.
export type StoredFile = { fileName: string; contentType: string; size: number; r2Key: string };

export type NewTicket = {
  customerCompany?: string;
  orderNo?: string;
  contactName: string;
  contactInfo: string;
  productId?: string | null;
  // The concrete model (from the PI's product line) and device SN, when known.
  productModel?: string | null;
  serialNumber?: string | null;
  assignedSalesId?: string | null;
  assignedServiceId?: string | null;
  feishuSourceChatId?: string | null;
  feishuSourceMessageId?: string | null;
  // A first timeline note written with the ticket (e.g. the quoted customer message).
  initialNote?: { actorId: string; text: string } | null;
  summary?: string | null;
};


// Whoever creates a ticket owns it: after-sales and admins become its
// after-sales owner, sales its sales owner, unless someone else was named.
export function ownersForCreator(creator: AppUser | null | undefined, input: Pick<NewTicket, "assignedSalesId" | "assignedServiceId">) {
  let assignedSalesId = input.assignedSalesId || null;
  let assignedServiceId = input.assignedServiceId || null;
  if (creator && canAssignServiceSide(creator) && !assignedServiceId) assignedServiceId = creator.id;
  else if (creator?.role === "SALES" && !assignedSalesId) assignedSalesId = creator.id;
  return { assignedSalesId, assignedServiceId };
}

// Type / fault type picked when the ticket is created (the Feishu request card
// or the portal's New ticket form). Skipped, as if not picked, when the creator
// may not classify tickets or the value is not valid.
export type NewTicketClassification = {
  ticketType?: unknown;
  faultType?: unknown;
};

// What a ticket created from a Feishu request starts with besides its fields.
// Never taken from a request body.
export type FeishuCreateOptions = NewTicketClassification & {
  // Files already in R2, attached to the first note.
  initialFiles?: StoredFile[];
  // The request card, which becomes the ticket's card when the creator is its
  // after-sales owner (no second card is sent).
  feishuCardMessageId?: string | null;
  // The device alert request (feishuDrafts id) the ticket was created from.
  alertDraftId?: string | null;
  // The claimed request the ticket is made from, linked in the same batch.
  request?: RequestClaim | null;
};

export async function createTicket(
  env: Env,
  input: NewTicket,
  opts: { requireProduct: boolean; creator?: AppUser | null } & FeishuCreateOptions
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

  const serialNumber = normalizeSerial(input.serialNumber).slice(0, 64) || null;
  if (serialNumber && !(await isKnownSerial(db, serialNumber))) throw new TicketError("That SN is not known to the system.", 400);
  const owners = ownersForCreator(opts.creator, input);
  const date = new Date().toISOString().slice(0, 10);
  const { seq, ticketNo } = await nextTicketNumber(env, date);
  const ticketId = id("tkt");
  const statements = [
    db
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
        // The questionnaire is gone; the column stays for tickets that have answers.
        "{}",
        owners.assignedSalesId,
        owners.assignedServiceId,
        input.feishuSourceChatId || null,
        input.feishuSourceMessageId || null,
        String(input.summary ?? "").trim().slice(0, 300) || null,
        String(input.productModel ?? "").trim().slice(0, 300) || null,
        serialNumber
      )
  ];
  let initialNoteId: string | null = null;
  if (input.initialNote?.text.trim()) {
    initialNoteId = id("tup");
    statements.push(
      db
        .prepare("INSERT INTO ticketUpdates (id, ticketId, actorId, kind, note) VALUES (?, ?, ?, 'NOTE', ?)")
        .bind(initialNoteId, ticketId, input.initialNote.actorId, input.initialNote.text.trim().slice(0, 4000))
    );
  }
  if (initialNoteId && opts.initialFiles?.length) {
    statements.push(...storedFileStatements(db, ticketId, initialNoteId, input.initialNote!.actorId, opts.initialFiles));
  }
  const classification = opts.creator ? await classifyNewTicket(db, opts.creator, ticketId, opts) : { statements: [], toPool: false, faultType: null };
  statements.push(...classification.statements);
  const ownCard = Boolean(opts.feishuCardMessageId && opts.creator && owners.assignedServiceId === opts.creator.id);
  if (ownCard) {
    statements.push(
      db.prepare("UPDATE tickets SET feishuCardMessageId = ?, feishuCardOwnerId = ? WHERE id = ?").bind(opts.feishuCardMessageId, opts.creator!.id, ticketId)
    );
  }
  if (opts.alertDraftId) {
    statements.push(db.prepare("UPDATE deviceStatus SET alertTicketId = ? WHERE alertDraftId = ?").bind(ticketId, opts.alertDraftId));
  }
  if (opts.request) statements.push(...requestLinkStatements(db, opts.request, ticketId));
  await commit(db, statements, "A ticket was already created for this.");
  const changes: TicketChange[] = [{ kind: "created" }];
  if (classification.toPool) changes.push({ kind: "type", ticketType: "PRODUCT_REQUEST", toPool: true });
  // A fault type picked at creation is no fault change, but it may make a repeat fault.
  const repeat = await repeatOf(db, product?.id ?? null, classification.faultType);
  if (repeat) changes.push(repeat);
  return { id: ticketId, ticketNo, initialNoteId, ownCard, changes };
}

// The type / fault type picked when a ticket is created (Feishu request or the
// portal form): a non-fault type, else a fault type from the list (which makes
// it a fault), else just "fault". A fault type not on the list skips the whole
// pick, as if nothing was picked. Written like setTicketType / confirmTicketFault.
async function classifyNewTicket(db: D1Database, user: AppUser, ticketId: string, opts: NewTicketClassification) {
  const none = { statements: [] as D1PreparedStatement[], toPool: false, faultType: null as string | null };
  if (!canConfirmFault(user)) return none;
  const ticketType = TICKET_TYPES.find((t) => t === opts.ticketType);
  const faultType = String(opts.faultType ?? "").trim();
  const typeNote = (type: TicketType) =>
    db.prepare("INSERT INTO ticketUpdates (id, ticketId, actorId, kind, note, isSystem) VALUES (?, ?, ?, 'NOTE', ?, 1)").bind(id("tup"), ticketId, user.id, `Ticket type: ${TICKET_TYPE_LABEL[type]}`);
  if (ticketType && ticketType !== "FAULT") {
    return {
      statements: [db.prepare("UPDATE tickets SET ticketType=?, updatedAt=CURRENT_TIMESTAMP WHERE id=?").bind(ticketType, ticketId), typeNote(ticketType)],
      toPool: ticketType === "PRODUCT_REQUEST",
      faultType: null
    };
  }
  if (faultType) {
    if (!(await isFaultTypeOption(db, faultType))) return none;
    return { statements: faultStatements(db, user, ticketId, faultType), toPool: false, faultType };
  }
  if (ticketType === "FAULT") {
    return { statements: [db.prepare("UPDATE tickets SET ticketType='FAULT', updatedAt=CURRENT_TIMESTAMP WHERE id=?").bind(ticketId), typeNote("FAULT")], toPool: false, faultType: null };
  }
  return none;
}

export async function changeTicketStatus(db: D1Database, user: AppUser, ticketId: string, to: TicketStatus) {
  const status = await statusStatements(db, user, ticketId, to);
  await commit(db, status.statements);
  const changes: TicketChange[] = [{ kind: "status", to }];
  return { from: status.from, to, changes };
}

// A status change and/or a progress note in one go (the Feishu card's "Update").
export async function updateProgress(db: D1Database, user: AppUser, ticketId: string, d: { status?: TicketStatus; note?: string }) {
  if (!d.status && !d.note) throw new TicketError("Choose a status or write a note.", 400);
  const status = d.status ? await statusStatements(db, user, ticketId, d.status) : null;
  const note = d.note ? await noteStatements(db, user, ticketId, d.note) : null;
  await commit(db, [...(status?.statements ?? []), ...(note?.statements ?? [])]);
  const changes: TicketChange[] = [];
  if (d.status) changes.push({ kind: "status", to: d.status });
  if (d.note) changes.push({ kind: "note" });
  return { changes };
}

// Moving the status, guarded: the UPDATE matches only while the ticket still
// has the status it was read with.
async function statusStatements(db: D1Database, user: AppUser, ticketId: string, to: TicketStatus) {
  if (!canChangeStatus(user)) throw new TicketError("Forbidden", 403);
  const ticket = await first<{ id: string; status: TicketStatus; ticketType: TicketType | null; faultType: string | null }>(
    db,
    "SELECT id, status, ticketType, faultType FROM tickets WHERE id=?",
    ticketId
  );
  if (!ticket) throw new TicketError("Not found", 404);
  if (!isValidTransition(ticket.status, to)) throw new TicketError(`Cannot move from ${ticket.status} to ${to}`, 400);
  const blocker = to === "RESOLVED" ? resolveBlocker(ticket) : null;
  if (blocker === "type") throw new TicketError("Choose the ticket type before resolving it.", 400);
  if (blocker === "fault") throw new TicketError("Confirm the fault type before resolving it.", 400);
  const statements = [
    db.prepare("UPDATE tickets SET status=?, updatedAt=CURRENT_TIMESTAMP WHERE id=? AND status=?").bind(to, ticket.id, ticket.status),
    // workflowGuard has CHECK (ok = 1): no row matched → the batch rolls back.
    db.prepare("INSERT INTO workflowGuard (ok) VALUES (changes())"),
    db.prepare("DELETE FROM workflowGuard"),
    db
      .prepare("INSERT INTO ticketUpdates (id, ticketId, actorId, kind, statusFrom, statusTo) VALUES (?, ?, ?, 'STATUS', ?, ?)")
      .bind(id("tup"), ticket.id, user.id, ticket.status, to)
  ];
  return { from: ticket.status, statements };
}

// A progress update, or a follow-up note added to an earlier update
// (`parentId`). The text may be empty only when files are attached: uploaded
// next (`withAttachments`), or already stored and attached here (`files`).
export async function addTicketNote(
  db: D1Database,
  user: AppUser,
  ticketId: string,
  rawNote: string,
  // request: the claimed Add to ticket this note saves, linked in the same batch.
  opts: { parentId?: string | null; withAttachments?: boolean; files?: StoredFile[]; request?: RequestClaim | null } = {}
): Promise<{ id: string; changes: TicketChange[] }> {
  const note = await noteStatements(db, user, ticketId, rawNote, opts);
  const link = opts.request ? requestLinkStatements(db, opts.request, ticketId) : [];
  await commit(db, [...note.statements, ...link], "Already added.");
  return { id: note.id, changes: [{ kind: "note" }] };
}

async function noteStatements(
  db: D1Database,
  user: AppUser,
  ticketId: string,
  rawNote: string,
  opts: { parentId?: string | null; withAttachments?: boolean; files?: StoredFile[] } = {}
) {
  if (!canWriteNote(user)) throw new TicketError("Forbidden", 403);
  const note = String(rawNote ?? "").trim();
  if (!note && !opts.withAttachments) throw new TicketError("Note is required", 400);
  const ticket = await first<{ id: string }>(db, "SELECT id FROM tickets WHERE id=?", ticketId);
  if (!ticket) throw new TicketError("Not found", 404);
  let parentId: string | null = null;
  if (opts.parentId) {
    const parent = await first<{ id: string; parentId: string | null }>(
      db,
      "SELECT id, parentId FROM ticketUpdates WHERE id=? AND ticketId=? AND kind='NOTE' AND isSystem=0",
      opts.parentId,
      ticket.id
    );
    if (!parent) throw new TicketError("That update no longer exists.", 400);
    parentId = parent.parentId ?? parent.id; // follow-ups stay one level deep
  }
  const updateId = id("tup");
  const statements = [
    db.prepare("INSERT INTO ticketUpdates (id, ticketId, actorId, kind, note, parentId) VALUES (?, ?, ?, 'NOTE', ?, ?)").bind(updateId, ticket.id, user.id, note.slice(0, 4000), parentId),
    db.prepare("UPDATE tickets SET updatedAt=CURRENT_TIMESTAMP WHERE id=?").bind(ticket.id),
    ...storedFileStatements(db, ticket.id, updateId, user.id, opts.files ?? [])
  ];
  return { id: updateId, statements };
}

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

// A picture or file on an update the user wrote; stored in R2 under the ticket.
export async function addTicketAttachment(
  env: Env,
  user: AppUser,
  ticketId: string,
  updateId: string,
  file: { name: string; contentType: string; body: ArrayBuffer }
) {
  if (!canWriteNote(user)) throw new TicketError("Forbidden", 403);
  const update = await first<{ id: string; actorId: string }>(
    env.DB,
    "SELECT id, actorId FROM ticketUpdates WHERE id=? AND ticketId=? AND kind='NOTE' AND isSystem=0",
    updateId,
    ticketId
  );
  if (!update) throw new TicketError("That update no longer exists.", 400);
  if (update.actorId !== user.id && user.role !== "ADMIN") throw new TicketError("You can only attach files to your own updates.", 403);
  if (!file.body.byteLength) throw new TicketError("The file is empty.", 400);
  if (file.body.byteLength > MAX_ATTACHMENT_BYTES) throw new TicketError("Files can be at most 20 MB.", 400);
  const fileName = file.name.replace(/[\\/\r\n]/g, "_").trim().slice(0, 200) || "file";
  const attachmentId = id("att");
  const r2Key = `tickets/${ticketId}/${attachmentId}`;
  await env.FILES.put(r2Key, file.body, { httpMetadata: { contentType: file.contentType || "application/octet-stream" } });
  await env.DB.prepare(
    "INSERT INTO ticketAttachments (id, ticketId, updateId, fileName, contentType, size, r2Key, uploadedById) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(attachmentId, ticketId, updateId, fileName, file.contentType || "application/octet-stream", file.body.byteLength, r2Key, user.id)
    .run();
  return { id: attachmentId, fileName, contentType: file.contentType, size: file.body.byteLength };
}

// Files already in R2 (material collected in Feishu) attached to a ticket
// update as they are, without copying them.
function storedFileStatements(db: D1Database, ticketId: string, updateId: string, uploadedById: string, files: StoredFile[]) {
  return files.map((f) =>
    db
      .prepare(
        "INSERT INTO ticketAttachments (id, ticketId, updateId, fileName, contentType, size, r2Key, uploadedById) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(id("att"), ticketId, updateId, f.fileName.slice(0, 200) || "file", f.contentType || "application/octet-stream", f.size, f.r2Key, uploadedById)
  );
}

// "Take" a ticket: become its after-sales owner and start work on it.
export async function takeTicket(db: D1Database, user: AppUser, ticketId: string) {
  if (!canAssignServiceSide(user) || !canChangeStatus(user)) throw new TicketError("Forbidden", 403);
  const ticket = await first<{ id: string; status: TicketStatus }>(db, "SELECT id, status FROM tickets WHERE id=?", ticketId);
  if (!ticket) throw new TicketError("Not found", 404);
  const assign = await assignStatements(db, user, ticket.id, { assignedServiceId: user.id });
  const status = ticket.status === "NEW" ? await statusStatements(db, user, ticket.id, "IN_PROGRESS") : null;
  await commit(db, [...assign.statements, ...(status?.statements ?? [])]);
  const changes: TicketChange[] = [{ kind: "taken" }];
  return { changes };
}

// Change who is responsible. After-sales/admins set the after-sales owner,
// sales/admins the sales owner. Every change is written to the timeline.
// New owners other than the user are told in Feishu.
export async function assignTicket(
  db: D1Database,
  user: AppUser,
  ticketId: string,
  d: { assignedSalesId?: string | null; assignedServiceId?: string | null }
): Promise<{ changed: boolean; changes: TicketChange[] }> {
  const assign = await assignStatements(db, user, ticketId, d);
  if (!assign.statements.length) return { changed: false, changes: [] };
  await commit(db, assign.statements);
  return { changed: true, changes: [{ kind: "assigned", newOwnerIds: assign.newOwnerIds }] };
}

async function assignStatements(
  db: D1Database,
  user: AppUser,
  ticketId: string,
  d: { assignedSalesId?: string | null; assignedServiceId?: string | null }
) {
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
  if (!changes.length) return { statements: [], newOwnerIds: [] };

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
  const statements = [
    db.prepare(`UPDATE tickets SET ${changes.map((ch) => `${ch.column}=?`).join(", ")}, updatedAt=CURRENT_TIMESTAMP WHERE id=?`).bind(...changes.map((ch) => ch.to), ticket.id),
    ...changes.map((ch) =>
      db
        .prepare("INSERT INTO ticketUpdates (id, ticketId, actorId, kind, note, isSystem) VALUES (?, ?, ?, 'NOTE', ?, 1)")
        .bind(id("tup"), ticket.id, user.id, `${ch.label}: ${name(ch.from)} → ${name(ch.to)} (changed by ${user.displayName})`)
    )
  ];
  const newOwnerIds = [
    changes.find((ch) => ch.column === "assignedServiceId")?.to ?? null,
    changes.find((ch) => ch.column === "assignedSalesId")?.to ?? null
  ].filter((v): v is string => Boolean(v) && v !== user.id);
  return { statements, newOwnerIds };
}

const CUSTOMER_FIELDS = [
  { key: "customerCompany", label: "Customer", max: 200, required: false },
  { key: "orderNo", label: "Production order no.", max: 100, required: false },
  { key: "contactName", label: "Contact name", max: 200, required: true },
  { key: "contactInfo", label: "Contact details", max: 200, required: true }
] as const;
type CustomerField = (typeof CUSTOMER_FIELDS)[number]["key"];

// Correct the customer, production order number and contact (edited in place
// on the ticket page). After-sales/admin; each change goes on the timeline.
export async function setTicketCustomer(
  db: D1Database,
  user: AppUser,
  ticketId: string,
  d: Partial<Record<CustomerField, unknown>>
): Promise<{ changed: boolean; changes: TicketChange[] }> {
  if (!canConfirmFault(user)) throw new TicketError("Forbidden", 403);
  const ticket = await first<Record<CustomerField, string> & { id: string }>(
    db,
    "SELECT id, customerCompany, orderNo, contactName, contactInfo FROM tickets WHERE id=?",
    ticketId
  );
  if (!ticket) throw new TicketError("Not found", 404);
  const next = { ...ticket };
  const notes: string[] = [];
  for (const f of CUSTOMER_FIELDS) {
    if (d[f.key] === undefined) continue;
    const value = String(d[f.key] ?? "").trim().slice(0, f.max);
    if (f.required && !value) throw new TicketError(`${f.label} cannot be empty.`, 400);
    if (value === ticket[f.key]) continue;
    next[f.key] = value;
    notes.push(`${f.label}: ${ticket[f.key] || "(none)"} → ${value || "(none)"}`);
  }
  if (!notes.length) return { changed: false, changes: [] };
  await commit(db, [
    db
      .prepare("UPDATE tickets SET customerCompany=?, orderNo=?, contactName=?, contactInfo=?, updatedAt=CURRENT_TIMESTAMP WHERE id=?")
      .bind(next.customerCompany, next.orderNo, next.contactName, next.contactInfo, ticket.id),
    ...notes.map((note) => db.prepare("INSERT INTO ticketUpdates (id, ticketId, actorId, kind, note, isSystem) VALUES (?, ?, ?, 'NOTE', ?, 1)").bind(id("tup"), ticket.id, user.id, note))
  ]);
  return { changed: true, changes: [{ kind: "product" }] };
}

// Which PI line the issue is about: the catalog product, the concrete
// generated model, and the device SN if known. The SN must be known to the
// system (registered on a PI or reported by the charger backend). Fields left
// out keep their value. Not written to the timeline.
export async function setTicketProduct(
  db: D1Database,
  user: AppUser,
  ticketId: string,
  d: { productId?: unknown; productModel?: unknown; serialNumber?: unknown }
): Promise<{ changes: TicketChange[] }> {
  if (!canConfirmFault(user)) throw new TicketError("Forbidden", 403);
  const ticket = await first<{ id: string; productId: string | null; productModel: string | null; serialNumber: string | null; faultType: string | null }>(
    db,
    "SELECT id, productId, productModel, serialNumber, faultType FROM tickets WHERE id=?",
    ticketId
  );
  if (!ticket) throw new TicketError("Not found", 404);
  let productId: string | null = ticket.productId;
  if (d.productId !== undefined) {
    const product = await first<{ id: string }>(db, "SELECT id FROM products WHERE id=?", String(d.productId));
    if (!product) throw new TicketError("A valid product is required.", 400);
    productId = product.id;
  }
  const productModel = d.productModel === undefined ? ticket.productModel : String(d.productModel ?? "").trim().slice(0, 300) || null;
  const serialNumber = d.serialNumber === undefined ? ticket.serialNumber : normalizeSerial(d.serialNumber).slice(0, 64) || null;
  if (serialNumber && serialNumber !== ticket.serialNumber && !(await isKnownSerial(db, serialNumber))) {
    throw new TicketError("That SN is not known to the system.", 400);
  }
  // Each change goes on the timeline, like the customer fields.
  const productName = async (pid: string | null) =>
    pid ? ((await first<{ name: string }>(db, "SELECT COALESCE(NULLIF(nameEn, ''), code) AS name FROM products WHERE id=?", pid))?.name ?? pid) : "";
  const notes: string[] = [];
  if (productId !== ticket.productId) notes.push(`Product: ${(await productName(ticket.productId)) || "(none)"} → ${(await productName(productId)) || "(none)"}`);
  if (productModel !== ticket.productModel) notes.push(`Model: ${ticket.productModel || "(none)"} → ${productModel || "(none)"}`);
  if (serialNumber !== ticket.serialNumber) notes.push(`SN: ${ticket.serialNumber || "(none)"} → ${serialNumber || "(none)"}`);
  await commit(db, [
    db
      .prepare("UPDATE tickets SET productId=?, productModel=?, serialNumber=?, updatedAt=CURRENT_TIMESTAMP WHERE id=?")
      .bind(productId, productModel, serialNumber, ticket.id),
    ...notes.map((note) => db.prepare("INSERT INTO ticketUpdates (id, ticketId, actorId, kind, note, isSystem) VALUES (?, ?, ?, 'NOTE', ?, 1)").bind(id("tup"), ticket.id, user.id, note))
  ]);
  const changes: TicketChange[] = [{ kind: "product" }];
  // A product given to a ticket whose fault is already known may make a repeat fault.
  const repeat = productId !== ticket.productId ? await repeatOf(db, productId, ticket.faultType) : null;
  if (repeat) changes.push(repeat);
  return { changes };
}

// Classify the ticket. Only faults keep a fault type; a one-line summary may
// be set at the same time. Returns whether it just became a product request.
export async function setTicketType(
  db: D1Database,
  user: AppUser,
  ticketId: string,
  d: { ticketType?: unknown; summary?: unknown }
): Promise<{ ticketType: TicketType; becameProductRequest: boolean; changes: TicketChange[] }> {
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
        .prepare("INSERT INTO ticketUpdates (id, ticketId, actorId, kind, note, isSystem) VALUES (?, ?, ?, 'NOTE', ?, 1)")
        .bind(id("tup"), ticket.id, user.id, `Ticket type: ${TICKET_TYPE_LABEL[ticketType]}`)
    );
  }
  await commit(db, statements);
  const becameProductRequest = ticketType === "PRODUCT_REQUEST" && ticket.ticketType !== "PRODUCT_REQUEST";
  return { ticketType, becameProductRequest, changes: [{ kind: "type", ticketType, toPool: becameProductRequest }] };
}

// Confirm the fault type (from the maintained list). Only confirmed fault types
// count in statistics and repeat-fault checks; a repeat fault goes with the
// change, so Feishu alerts the after-sales group.
export async function confirmTicketFault(db: D1Database, user: AppUser, ticketId: string, rawFaultType: string) {
  if (!canConfirmFault(user)) throw new TicketError("Forbidden", 403);
  const faultType = String(rawFaultType ?? "").trim();
  const ticket = await first<{ id: string; productId: string | null }>(db, "SELECT id, productId FROM tickets WHERE id=?", ticketId);
  if (!ticket) throw new TicketError("Not found", 404);
  if (!(await isFaultTypeOption(db, faultType))) throw new TicketError("Choose a fault type from the list.", 400);
  await commit(db, faultStatements(db, user, ticket.id, faultType));
  const repeat = await repeatInfo(db, ticket.productId, faultType, new Date());
  const changes: TicketChange[] = [{ kind: "fault", repeat: repeat?.isRepeat ? repeat : null }];
  return { productId: ticket.productId, faultType, repeat, changes };
}

async function isFaultTypeOption(db: D1Database, faultType: string) {
  const allowed = await all<{ value: string }>(db, "SELECT value FROM appOptions WHERE optionKey = ?", FAULT_TYPE_OPTION_KEY);
  return allowed.some((o) => o.value === faultType);
}

// The repeat change when this product and fault type are now a repeat fault.
async function repeatOf(db: D1Database, productId: string | null, faultType: string | null): Promise<TicketChange | null> {
  const repeat = await repeatInfo(db, productId, faultType, new Date());
  return repeat?.isRepeat ? { kind: "repeat", repeat } : null;
}

function faultStatements(db: D1Database, user: AppUser, ticketId: string, faultType: string) {
  return [
    db
      .prepare("UPDATE tickets SET faultType=?, ticketType='FAULT', faultConfirmedById=?, faultConfirmedAt=CURRENT_TIMESTAMP, updatedAt=CURRENT_TIMESTAMP WHERE id=?")
      .bind(faultType, user.id, ticketId),
    db
      .prepare("INSERT INTO ticketUpdates (id, ticketId, actorId, kind, note, isSystem) VALUES (?, ?, ?, 'NOTE', ?, 1)")
      .bind(id("tup"), ticketId, user.id, `Fault type confirmed: ${faultType}`)
  ];
}
