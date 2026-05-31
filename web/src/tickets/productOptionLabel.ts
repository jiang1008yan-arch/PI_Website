import type { PublicProduct } from "../types";

export function ticketProductOptionLabel(product: PublicProduct) {
  return product.nameEn || product.code;
}
