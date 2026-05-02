import type { Env, Language } from "./types";

export async function nextPiNumber(env: Env, language: Language, date: string) {
  const ymd = date.replaceAll("-", "");
  const row = await env.DB.prepare("SELECT MAX(seq) as maxSeq FROM pi WHERE date = ?").bind(date).first<{ maxSeq: number | null }>();
  const seq = (row?.maxSeq ?? 0) + 1;
  const suffix = language === "ZH" ? "CN" : "IT";
  return { seq, piNo: `INJET20060-${suffix}-${ymd}${String(seq).padStart(3, "0")}` };
}
