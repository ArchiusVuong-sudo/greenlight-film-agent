import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiveProvider } from "../agent/live";
import type { AgentProvider, Fixture } from "../agent/provider";
import { ReplayProvider } from "../agent/replay";
import { executeRun, type AutoDirector } from "../agent/runner";
import type { Brief } from "../lib/briefs";
import { openDb, type DB } from "../lib/db";
import { createRun } from "../lib/runs";
import { createFilm } from "../lib/studio";
import { RenderQueue } from "../worker/queue";

export interface HeadlessResult {
  db: DB;
  filmId: string;
  runId: string;
  durationMs: number;
  /** Closes the database and removes its temp folder. */
  dispose: () => void;
}

/**
 * Runs one brief end to end without the web app: its own SQLite file, its own render queue,
 * the live or replay provider and an auto-director answering the cards.
 */
export async function runBrief(
  brief: Brief,
  opts: { provider: "live" | "replay"; fixture?: Fixture | null; director: AutoDirector; recordTo?: string; model?: string; latencyScale?: number; dbPath?: string; pollMs?: number },
): Promise<HeadlessResult> {
  const dir = opts.dbPath ? null : mkdtempSync(join(tmpdir(), "greenlight-eval-"));
  const db = openDb(opts.dbPath ?? join(dir!, "eval.db"));
  const queue = new RenderQueue(db, { latencyScale: opts.latencyScale ?? 0.3 });
  queue.start(50);
  const film = createFilm(db, brief);
  let provider: AgentProvider;
  if (opts.provider === "live") provider = new LiveProvider();
  else {
    if (!opts.fixture) throw new Error(`No recorded run for ${brief.briefId}`);
    provider = new ReplayProvider(opts.fixture, 0);
  }
  const run = createRun(db, film.id, provider.name, { recordTo: opts.recordTo });
  const t0 = Date.now();
  try {
    await executeRun(db, run.id, { provider, director: opts.director, recordTo: opts.recordTo, model: opts.model, pollMs: opts.pollMs ?? 100, maxRetries: 4 });
    await queue.drain(60_000).catch(() => undefined);
  } finally {
    queue.stop();
  }
  const dispose = () => {
    if (db.open) db.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  };
  return { db, filmId: film.id, runId: run.id, durationMs: Date.now() - t0, dispose };
}
