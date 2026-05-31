import type { Env } from "./types";

// Per-day sequence, mirrors piNumber. ticketNo = TK-<yyyymmdd>-<seq3>.
export async function nextTicketNumber(env: Env, date: string) {
  const ymd = date.replaceAll("-", "");
  await env.DB.prepare(
    `INSERT INTO ticketNumberSequences (date, lastSeq) VALUES (?, 0) ON CONFLICT(date) DO NOTHING`
  )
    .bind(date)
    .run();
  const row = await env.DB.prepare(
    "UPDATE ticketNumberSequences SET lastSeq = lastSeq + 1 WHERE date = ? RETURNING lastSeq"
  )
    .bind(date)
    .first<{ lastSeq: number }>();
  const seq = row?.lastSeq ?? 1;
  return { seq, ticketNo: `TK-${ymd}-${String(seq).padStart(3, "0")}` };
}
