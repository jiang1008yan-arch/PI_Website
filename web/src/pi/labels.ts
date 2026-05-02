import type { Language, Pi, Product } from "../types";

export function piDisplayName(pi: Pi, language: Language) {
  if (language === "ZH") return pi.productionOrderNo || pi.piNo;
  return pi.piNo;
}

export function isConfirmedReceivedPi(pi: Pi, userId: string | undefined) {
  return pi.language === "ZH" && pi.status === "APPROVED" && pi.assignedToId === userId && pi.createdById !== userId;
}

export function isUserApprovedChinesePi(pi: Pi, userId: string | undefined) {
  return pi.language === "ZH" && pi.status === "APPROVED" && (pi.assignedToId === userId || pi.createdById === userId);
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
