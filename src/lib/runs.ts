import { randomBytes } from "node:crypto";
import { logActivity } from "./activity";
import type { DB } from "./db";

export type RunStatus = "queued" | "running" | "waiting" | "idle" | "done" | "stopped" | "error";
export const ACTIVE_STATUSES: RunStatus[] = ["queued", "running", "waiting", "idle"];

export interface Run {
  id: string;
  filmId: string;
  provider: string;
  model: string | null;
  status: RunStatus;
  paused: boolean;
  sessionId: string | null;
  turns: number;
  tokensIn: number;
  tokensOut: number;
  tokensCache: number;
  costUsd: number;
  error: string | null;
  recordTo: string | null;
  startedAt: number;
  endedAt: number | null;
}

interface RunDbRow {
  id: string;
  film_id: string;
  provider: string;
  model: string | null;
  status: RunStatus;
  paused: number;
  session_id: string | null;
  turns: number;
  tokens_in: number;
  tokens_out: number;
  tokens_cache: number;
  cost_usd: number;
  error: string | null;
  record_to: string | null;
  started_at: number;
  ended_at: number | null;
}

function toRun(r: RunDbRow): Run {
  return {
    id: r.id,
    filmId: r.film_id,
    provider: r.provider,
    model: r.model,
    status: r.status,
    paused: r.paused === 1,
    sessionId: r.session_id,
    turns: r.turns,
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
    tokensCache: r.tokens_cache,
    costUsd: r.cost_usd,
    error: r.error,
    recordTo: r.record_to,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  };
}

export function createRun(db: DB, filmId: string, provider: string, opts: { recordTo?: string | null } = {}): Run {
  const active = activeRun(db, filmId);
  if (active) throw new Error(`Film ${filmId} already has an active run (${active.id})`);
  const id = `run-${randomBytes(4).toString("hex")}`;
  db.prepare("INSERT INTO runs (id, film_id, provider, status, record_to, started_at) VALUES (?, ?, ?, 'queued', ?, ?)").run(id, filmId, provider, opts.recordTo ?? null, Date.now());
  return getRun(db, id)!;
}

export function getRun(db: DB, id: string): Run | undefined {
  const r = db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunDbRow | undefined;
  return r ? toRun(r) : undefined;
}

export function listRuns(db: DB, filmId: string): Run[] {
  return (db.prepare("SELECT * FROM runs WHERE film_id = ? ORDER BY started_at").all(filmId) as RunDbRow[]).map(toRun);
}

/** One active run per film. */
export function activeRun(db: DB, filmId: string): Run | undefined {
  const r = db
    .prepare(`SELECT * FROM runs WHERE film_id = ? AND status IN (${ACTIVE_STATUSES.map(() => "?").join(",")}) ORDER BY started_at DESC LIMIT 1`)
    .get(filmId, ...ACTIVE_STATUSES) as RunDbRow | undefined;
  return r ? toRun(r) : undefined;
}

export function updateRun(db: DB, id: string, patch: Partial<Record<keyof RunDbRow, string | number | null>>): void {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  db.prepare(`UPDATE runs SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => patch[k as keyof RunDbRow] ?? null), id);
}

/**
 * Sends a message to the film's assistant: a director answer, Continue or a typed instruction.
 * With no active run (the last one ended) a new run starts and picks the message up.
 */
export function deliverInput(db: DB, filmId: string, text: string, source: "director" | "continue" | "instruction", provider: string): Run {
  let run = activeRun(db, filmId);
  if (!run) run = createRun(db, filmId, provider);
  db.prepare("UPDATE runs SET paused = 0 WHERE id = ?").run(run.id);
  db.prepare("INSERT INTO run_inputs (run_id, text, source, created_at) VALUES (?, ?, ?, ?)").run(run.id, text, source, Date.now());
  logActivity(db, { filmId, runId: run.id, kind: "director", name: source, status: "info", summary: text });
  return run;
}

export function takeInput(db: DB, runId: string): { text: string; source: string } | null {
  const r = db.prepare("SELECT id, text, source FROM run_inputs WHERE run_id = ? AND consumed_at IS NULL ORDER BY id LIMIT 1").get(runId) as
    | { id: number; text: string; source: string }
    | undefined;
  if (!r) return null;
  db.prepare("UPDATE run_inputs SET consumed_at = ? WHERE id = ?").run(Date.now(), r.id);
  return { text: r.text, source: r.source };
}

export function pendingInputs(db: DB, runId: string): string[] {
  return (db.prepare("SELECT text FROM run_inputs WHERE run_id = ? AND consumed_at IS NULL ORDER BY id").all(runId) as { text: string }[]).map((r) => r.text);
}

export function setPaused(db: DB, filmId: string, paused: boolean): Run | undefined {
  const run = activeRun(db, filmId);
  if (!run) return undefined;
  db.prepare("UPDATE runs SET paused = ? WHERE id = ?").run(paused ? 1 : 0, run.id);
  logActivity(db, { filmId, runId: run.id, kind: "director", name: paused ? "pause" : "resume", status: "info", summary: paused ? "Director paused the run" : "Director resumed the run" });
  return getRun(db, run.id);
}
