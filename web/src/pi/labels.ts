import type { Language, Pi, PiReviewEvent, PiStatus, Product } from "../types";

export function piDisplayName(pi: Pi, language: Language) {
  // A linked Chinese draft is named after its English PI No. (需求1); standalone
  // Chinese PIs fall back to their production order number, then their own piNo.
  if (language === "ZH") return pi.linkedPiNo || pi.linkedPiNoSnapshot || pi.productionOrderNo || pi.piNo;
  return pi.piNo;
}

export function isConfirmedReceivedPi(pi: Pi, userId: string | undefined) {
  return pi.language === "ZH" && pi.status === "APPROVED" && pi.assignedToId === userId && pi.createdById !== userId;
}

export function isUserApprovedChinesePi(pi: Pi, userId: string | undefined) {
  return pi.language === "ZH" && pi.status === "APPROVED" && (pi.assignedToId === userId || pi.createdById === userId);
}

// Status as shown to people. The first ZH approval step is "presales
// confirmation" (the recipient's Confirm Received); the final one is
// "commerce approval" — only then is a PI approved.
export function piStatusLabel(status: PiStatus | string, language: Language = "ZH") {
  if (language === "EN") return status === "SUBMITTED" ? "Submitted" : status === "DRAFT" ? "Draft" : String(status);
  return ({
    DRAFT: "Draft",
    REJECTED: "Rejected",
    PENDING_REVIEW: "Pending presales confirmation",
    PENDING_COMMERCE: "Pending commerce approval",
    APPROVED: "Approved",
    SUBMITTED: "Submitted"
  } as Record<string, string>)[status] ?? String(status);
}

export function revisionLabel(revisionNo: number | undefined) {
  return `Rev ${revisionNo && revisionNo > 0 ? revisionNo : 1}`;
}

// One line of review history: what happened, at which step, in which revision.
export function reviewEventLabel(e: PiReviewEvent) {
  const step = e.step === "COMMERCE" ? "Commerce" : e.step === "PRESALES" ? "Presales" : "";
  const what = ({
    SUBMITTED: "Sent for presales confirmation",
    APPROVED: e.step === "COMMERCE" ? "Commerce approved" : "Presales confirmed",
    REJECTED: `${step || "Reviewer"} rejected`,
    REVISION_STARTED: "Revision started",
    REVISION_ABANDONED: "Revision abandoned"
  } as Record<string, string>)[e.action] ?? e.action;
  return `${revisionLabel(e.revisionNo)} · ${what}`;
}

export function productOptionLabel(product: Product, language: Language) {
  const name = language === "EN" ? product.nameEn : product.nameZh;
  return name || product.code;
}

export function productName(product: Product | undefined, language: Language) {
  if (!product) return "";
  return language === "EN" ? product.nameEn : product.nameZh;
}

export function labelForCustomer(key: string) {
  return (
    ({
      customerCompany: "Company",
      customerContact: "Contact",
      customerEmail: "Email",
      customerPhone: "Phone",
      customerAddress: "Address"
    } as Record<string, string>)[key] ?? key
  );
}

export function labelForSender(key: string) {
  return (
    ({
      senderCorp: "Corp",
      senderAddress: "Address",
      senderFrom: "From",
      senderPhone: "Phone",
      senderEmail: "Email"
    } as Record<string, string>)[key] ?? key
  );
}

export function senderDefaultsFrom(sender: any) {
  return {
    senderCorp: sender?.corp ?? "",
    senderAddress: sender?.address ?? "",
    senderFrom: sender?.fromName ?? "",
    senderPhone: sender?.phone ?? "",
    senderEmail: sender?.email ?? ""
  };
}
