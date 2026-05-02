export type Role = "ADMIN" | "USER";
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
  createdById?: string;
  createdAt?: string;
  updatedAt?: string;
  archivedAt?: string | null;
};
