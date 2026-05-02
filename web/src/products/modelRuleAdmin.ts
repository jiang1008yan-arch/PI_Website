import { api } from "../api/client";
import type { Language } from "../types";
import { blankRule, ModelOption, ModelRule, modelRuleKey, normalizeRule, optionPath } from "../pi/modelRule";

export async function loadProductModelRule(productId: string, language: Language): Promise<ModelRule> {
  const res = await api.get(optionPath(modelRuleKey(productId, language)));
  const raw = res.data[0]?.value;
  if (!raw) return blankRule();
  try {
    return normalizeRule(JSON.parse(raw), { generateSegmentIds: true });
  } catch {
    return blankRule();
  }
}

export function parseModelOptions(text: string): ModelOption[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([^=:：]+)\s*[=:：]\s*(.*)$/);
      return match ? { code: match[1].trim(), description: match[2].trim() } : { code: line, description: "" };
    });
}

export function formatModelOptions(options: ModelOption[]) {
  return options.map((option) => `${option.code} = ${option.description}`).join("\n");
}
