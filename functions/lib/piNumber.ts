import type { Env, Language } from "./types";

export async function nextPiNumber(env: Env, language: Language, date: string) {
  const ymd = date.replaceAll("-", "");
  await env.DB.prepare(
    `INSERT INTO piNumberSequences (date, lastSeq)
      VALUES (?, (SELECT COALESCE(MAX(seq), 0) FROM pi WHERE date = ?))
      ON CONFLICT(date) DO NOTHING`
  )
    .bind(date, date)
    .run();

  const row = await env.DB.prepare(
    "UPDATE piNumberSequences SET lastSeq = lastSeq + 1 WHERE date = ? RETURNING lastSeq"
  )
    .bind(date)
    .first<{ lastSeq: number }>();
  const seq = row?.lastSeq ?? 1;
  const suffix = language === "ZH" ? "CN" : "IT";
  return { seq, piNo: `INJET20060-${suffix}-${ymd}${String(seq).padStart(3, "0")}` };
}
