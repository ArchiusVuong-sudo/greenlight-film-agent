import { detectMode } from "../agent/detect";
import { LiveProvider } from "../agent/live";
import type { AgentProvider } from "../agent/provider";
import { loadFixture, ReplayProvider } from "../agent/replay";
import { executeRun } from "../agent/runner";
import { logActivity } from "../lib/activity";
import { openDb, setMeta, type DB } from "../lib/db";
import { getFilm } from "../lib/studio";
import { RenderQueue } from "./queue";

/**
 * The worker process: the render queue plus the assistant runs. The web app only reads and writes
 * SQLite; everything that spends time or talks to the model happens here.
 */
export function providerFor(db: DB, filmId: string, mode: "live" | "replay"): AgentProvider {
  if (mode === "live") return new LiveProvider();
  const fixture = loadFixture(getFilm(db, filmId).briefId);
  if (!fixture) throw new Error("Replay mode needs a recorded run in fixtures/. Run npm run record with a Claude Code login.");
  return new ReplayProvider(fixture);
}

async function main(): Promise<void> {
  const db = openDb();
  const detected = detectMode();
  let mode = detected.mode;
  setMeta(db, "mode", mode);
  setMeta(db, "mode_reason", detected.reason);
  setMeta(db, "model", process.env.AGENT_MODEL || "");
  console.log(`[worker] ${mode} mode (${detected.reason}), db ${db.name}`);

  const queue = new RenderQueue(db);
  queue.recover();
  queue.start();

  // Sessions are not saved to disk, so runs cut off by a restart end here; Continue starts a fresh one.
  const cut = db.prepare("SELECT id, film_id FROM runs WHERE status IN ('running', 'waiting', 'idle')").all() as { id: string; film_id: string }[];
  for (const r of cut) {
    db.prepare("UPDATE runs SET status = 'stopped', error = 'Worker restarted', ended_at = ? WHERE id = ?").run(Date.now(), r.id);
    logActivity(db, { filmId: r.film_id, runId: r.id, kind: "system", name: "run", status: "info", summary: "Run stopped by a worker restart. Press Continue to pick it up." });
  }

  const active = new Set<string>();
  const tick = () => {
    setMeta(db, "worker_heartbeat", String(Date.now()));
    const queued = db.prepare("SELECT id, film_id FROM runs WHERE status = 'queued' ORDER BY started_at").all() as { id: string; film_id: string }[];
    for (const r of queued) {
      if (active.has(r.film_id)) continue;
      active.add(r.film_id);
      let provider: AgentProvider;
      try {
        provider = providerFor(db, r.film_id, mode);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        db.prepare("UPDATE runs SET status = 'error', error = ?, ended_at = ? WHERE id = ?").run(msg, Date.now(), r.id);
        logActivity(db, { filmId: r.film_id, runId: r.id, kind: "system", name: "run", status: "error", summary: msg });
        active.delete(r.film_id);
        continue;
      }
      void executeRun(db, r.id, {
        provider,
        model: process.env.AGENT_MODEL || undefined,
        onAuthError: () => {
          if (!loadFixture(getFilm(db, r.film_id).briefId)) return null;
          mode = "replay";
          setMeta(db, "mode", "replay");
          setMeta(db, "mode_reason", "The Claude Code login did not work");
          return providerFor(db, r.film_id, "replay");
        },
      })
        .catch((e) => console.error("[worker] run failed", e))
        .finally(() => active.delete(r.film_id));
    }
  };
  const timer = setInterval(tick, 300);
  tick();

  const shutdown = () => {
    clearInterval(timer);
    queue.stop();
    db.prepare("UPDATE runs SET status = 'stopped', error = 'Worker stopped', ended_at = ? WHERE status IN ('running', 'waiting', 'idle', 'queued')").run(Date.now());
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
