export type Role = "ADMIN" | "SALES" | "SERVICE";
export type Language = "EN" | "ZH";
export type PiStatus = "DRAFT" | "PENDING_REVIEW" | "REJECTED" | "APPROVED" | "SUBMITTED";
export type ProductStatus = "ACTIVE" | "DISCONTINUED";

export type User = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  createdAt?: string;
};

export type Category = {
  id: string;
  code: string;
  nameEn: string;
  nameZh: string;
};

export type Product = {
  id: string;
  code: string;
  nameEn: string;
  nameZh: string;
  categoryId: string;
  status: ProductStatus;
};

export type ProductField = {
  id?: string;
  productId?: string;
  language: Language;
  label: string;
  fieldType: "TEXT" | "DROPDOWN";
  options?: string[];
  defaultValue?: string;
  sortOrder: number;
  mapKey?: string | null;
};

export type FieldValue = {
  label: string;
  value: string;
  fieldType: string;
  options?: string[];
  sortOrder: number;
};

export type PiItem = {
  productId: string;
  quantity: number;
  unitPrice: number;
  discountPct: number;
  fieldValues: FieldValue[];
};

export type Pi = {
  id: string;
  language: Language;
  piNo: string;
  seq?: number;
  status: PiStatus;
  date: string;
  customerCompany: string;
  customerContact?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerCountry?: string;
  customerAddress?: string;
  validUntil?: string;
  incoterm?: string;
  shipmentMode?: string;
  paymentTerm?: string;
  productionOrderNo?: string;
  customerSource?: string;
  customerType?: string;
  deliveryDate?: string;
  senderCorp?: string;
  senderAddress?: string;
  senderFrom?: string;
  senderPhone?: string;
  senderEmail?: string;
  otherRequirements?: string;
  rejectionNote?: string;
  assignedToId?: string | null;
  submittedSnapshot?: string | null;
  createdById?: string;
  createdAt?: string;
  updatedAt?: string;
  archivedAt?: string | null;
  linkedPiId?: string | null;
  linkedPiNo?: string | null;
  linkedPiNoSnapshot?: string | null;
  linkedPiStatus?: string | null;
};

export type TicketStatus = "NEW" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";

export type TicketField = {
  id?: string;
  label: string;
  fieldType: "TEXT" | "DROPDOWN";
  options?: string[];
  required: number;
  sortOrder: number;
};

export type Ticket = {
  id: string;
  ticketNo: string;
  seq: number;
  status: TicketStatus;
  customerCompany: string;
  orderNo: string;
  contactName: string;
  contactInfo: string;
  productId?: string | null;
  productCode?: string | null;
  productNameEn?: string | null;
  productNameZh?: string | null;
  answers: string;
  assignedSalesId?: string | null;
  assignedServiceId?: string | null;
  assignedSalesName?: string | null;
  assignedServiceName?: string | null;
  linkId?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type TicketUpdate = {
  id: string;
  ticketId: string;
  actorId: string;
  actorName?: string | null;
  kind: "STATUS" | "NOTE";
  statusFrom?: string | null;
  statusTo?: string | null;
  note?: string | null;
  createdAt: string;
};

export type TicketLink = {
  id: string;
  token: string;
  customerCompany: string;
  orderNo: string;
  createdById: string;
  createdByRole: Role;
  assignedSalesId?: string | null;
  assignedServiceId?: string | null;
  expiresAt: string;
  revokedAt?: string | null;
  createdAt: string;
  useCount?: number;
};

export type TicketStats = {
  byStatus: { status: string; n: number }[];
  byProduct: { productId: string; name: string; n: number }[];
  problemType: { label: string; counts: Record<string, number> } | null;
};

export type PublicProduct = { id: string; code: string; nameEn: string; nameZh: string };
