import { json, type DB } from "./db";

export type ActivityKind = "turn" | "tool" | "job" | "director" | "system";
export type ActivityStatus = "ok" | "error" | "refused" | "paused" | "info";

export interface ActivityInput {
  filmId: string;
  runId?: string | null;
  kind: ActivityKind;
  name: string;
  status: ActivityStatus;
  summary: string;
  durationMs?: number | null;
  credits?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  detail?: unknown;
}

export interface ActivityRow extends Omit<ActivityInput, "detail"> {
  id: number;
  ts: number;
  detail: unknown;
}

export function logActivity(db: DB, a: ActivityInput): number {
  const r = db
    .prepare(
      "INSERT INTO activity (film_id, run_id, ts, kind, name, status, duration_ms, credits, tokens_in, tokens_out, summary, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      a.filmId,
      a.runId ?? null,
      Date.now(),
      a.kind,
      a.name,
      a.status,
      a.durationMs ?? null,
      a.credits ?? null,
      a.tokensIn ?? null,
      a.tokensOut ?? null,
      a.summary.slice(0, 600),
      a.detail === undefined ? null : JSON.stringify(a.detail).slice(0, 20_000),
    );
  return Number(r.lastInsertRowid);
}

export function listActivity(db: DB, filmId: string, limit = 400): ActivityRow[] {
  const rows = db.prepare("SELECT * FROM (SELECT * FROM activity WHERE film_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id").all(filmId, limit) as {
    id: number;
    film_id: string;
    run_id: string | null;
    ts: number;
    kind: ActivityKind;
    name: string;
    status: ActivityStatus;
    duration_ms: number | null;
    credits: number | null;
    tokens_in: number | null;
    tokens_out: number | null;
    summary: string;
    detail: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    filmId: r.film_id,
    runId: r.run_id,
    ts: r.ts,
    kind: r.kind,
    name: r.name,
    status: r.status,
    durationMs: r.duration_ms,
    credits: r.credits,
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
    summary: r.summary,
    detail: json(r.detail, null),
  }));
}
