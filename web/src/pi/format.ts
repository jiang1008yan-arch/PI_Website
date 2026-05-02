export const currencies = [
  { code: "USD", symbol: "US$" },
  { code: "EUR", symbol: "EUR" },
  { code: "CNY", symbol: "CNY" },
  { code: "GBP", symbol: "GBP" },
  { code: "AUD", symbol: "A$" }
];

export function formatCurrency(value: number, currency: string) {
  const symbol = currencies.find((item) => item.code === currency)?.symbol ?? currency;
  return `${symbol}${formatNumber(value)}`;
}

export function formatNumber(value: number | string | null | undefined) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Number(value || 0)
  );
}

export function numericInputValue(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);
  return numeric === 0 ? "" : String(value);
}

export function parseNumericInput(value: string) {
  return value.trim() === "" ? 0 : Number(value);
}
