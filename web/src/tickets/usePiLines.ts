import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { generatedModelFor } from "../../../shared/modelRule";
import { parsePiItems, type ParsedPiItem } from "../../../shared/piItemCodec";

export type PiLineOption = { key: string; productId: string; model: string; label: string };

// The product lines of an approved Chinese PI (its effective version), each
// with the concrete model the PI generates — what a ticket's product and model
// should be picked from. Empty when there is no PI or it cannot be read.
export function usePiLines(piId: string | null | undefined) {
  const [lines, setLines] = useState<ParsedPiItem[]>([]);

  useEffect(() => {
    setLines([]);
    if (!piId) return;
    api
      .get(`/pi/${piId}/view`)
      .then((res) => {
        const zh = res.data.zh.effective ?? res.data.zh.current;
        setLines(zh ? parsePiItems(zh.items ?? []) : []);
      })
      .catch(() => setLines([]));
  }, [piId]);

  const options = useMemo<PiLineOption[]>(
    () =>
      lines.map((item, idx) => {
        const model = generatedModelFor(item).model;
        return {
          key: String(idx),
          productId: item.productId,
          model,
          label: `${item.nameZh || item.nameEn || item.code || item.productId}${model ? ` · ${model}` : ""} · qty ${item.quantity}`
        };
      }),
    [lines]
  );
  return options;
}
