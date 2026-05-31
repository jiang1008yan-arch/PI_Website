// 需求2 — validate public questionnaire answers against the admin-configured
// ticketFields. Answers are keyed by field id. Returns a cleaned answers object
// (only known fields, trimmed/length-capped) or an error string.

export type TicketFieldRow = {
  id: string;
  label: string;
  fieldType: "TEXT" | "DROPDOWN";
  options: string | null;
  required: number;
};

const MAX_TEXT = 2000;

function parseOptions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function validateAnswers(
  fields: TicketFieldRow[],
  raw: unknown
): { ok: true; answers: Record<string, string> } | { ok: false; error: string } {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const answers: Record<string, string> = {};
  for (const field of fields) {
    const value = input[field.id];
    const str = value == null ? "" : String(value).trim();
    if (!str) {
      if (field.required) return { ok: false, error: `"${field.label}" is required` };
      continue;
    }
    if (field.fieldType === "DROPDOWN") {
      const options = parseOptions(field.options);
      if (!options.includes(str)) return { ok: false, error: `Invalid option for "${field.label}"` };
    } else if (str.length > MAX_TEXT) {
      return { ok: false, error: `"${field.label}" is too long` };
    }
    answers[field.id] = str;
  }
  return { ok: true, answers };
}
