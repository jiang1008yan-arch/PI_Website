// Serial numbers (SN) of delivered devices. One SN belongs to exactly one PI.

// What one SN may look like: letters, digits and - _ / . — 3 to 64 characters.
const SN_PATTERN = /^[A-Z0-9][A-Z0-9\-_/.]{2,63}$/;

export type ParsedSerials = { serials: string[]; invalid: string[] };

// Parses pasted text (one SN per line; commas, semicolons and tabs also split)
// into normalized SNs: trimmed, upper-cased, de-duplicated in input order.
export function parseSerials(input: string | string[]): ParsedSerials {
  const raw = Array.isArray(input) ? input : String(input ?? "").split(/[\r\n,;\t]+/);
  const serials: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const sn = String(entry ?? "").trim().toUpperCase();
    if (!sn) continue;
    if (!SN_PATTERN.test(sn)) {
      invalid.push(String(entry).trim());
      continue;
    }
    if (seen.has(sn)) continue;
    seen.add(sn);
    serials.push(sn);
  }
  return { serials, invalid };
}

export function normalizeSerial(sn: unknown): string {
  return String(sn ?? "").trim().toUpperCase();
}
