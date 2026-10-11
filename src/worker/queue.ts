import { logActivity } from "../lib/activity";
import { DEFAULT_PALETTE, saveAsset, toRenderElement } from "../lib/assets";
import type { DB } from "../lib/db";
import { addEntry } from "../lib/ledger";
import { renderFrame, renderReference } from "../lib/render/svg";
import { describeJob, getFilm, listElements, listLooks, listScenes, toJob } from "../lib/studio";
import type { JobRow } from "../lib/types";

export const MAX_ATTEMPTS = 3;
export const SIMULATED_TIMEOUT = "provider timeout (simulated)";

export interface QueueOptions {
  /** Jobs that run at the same time (the provider's concurrency limit). */
  concurrency?: number;
  /** Multiplies the simulated 1-3 s render time. */
  latencyScale?: number;
  random?: () => number;
}

/**
 * The simulated generation provider. Jobs live in SQLite; this loop runs two at a time,
 * reports progress, retries a failed attempt on the same idempotency key and settles holds.
 */
export class RenderQueue {
  private running = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  readonly concurrency: number;
  readonly scale: number;
  private random: () => number;

  constructor(
    private db: DB,
    opts: QueueOptions = {},
  ) {
    this.concurrency = opts.concurrency ?? 2;
    this.scale = opts.latencyScale ?? Number(process.env.RENDER_LATENCY_SCALE ?? 1);
    this.random = opts.random ?? Math.random;
  }

  /** Jobs left running by a stopped worker go back to the queue. */
  recover(): void {
    this.db.prepare("UPDATE jobs SET status = 'queued', progress = 0 WHERE status = 'running'").run();
  }

  start(intervalMs = 150): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get active(): number {
    return this.running.size;
  }

  tick(): void {
    const free = this.concurrency - this.running.size;
    if (free <= 0) return;
    const rows = this.db
      .prepare("SELECT * FROM jobs WHERE status IN ('queued', 'retrying') AND next_attempt_at <= ? ORDER BY created_at, rowid LIMIT ?")
      .all(Date.now(), free + this.running.size) as Parameters<typeof toJob>[0][];
    for (const r of rows) {
      const key = `${r.film_id}/${r.id}`;
      if (this.running.has(key) || this.running.size >= this.concurrency) continue;
      this.running.add(key);
      void this.run(r.film_id, toJob(r)).finally(() => this.running.delete(key));
    }
  }

  /** Resolves when no job is queued, retrying or running (used by tests and the eval runner). */
  async drain(timeoutMs = 30_000): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      this.tick();
      const left = this.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued', 'retrying', 'running')").get() as { n: number };
      if (left.n === 0 && this.running.size === 0) return;
      await sleep(20);
    }
    throw new Error("Render queue did not drain in time");
  }

  private async run(filmId: string, job: JobRow): Promise<void> {
    const attempt = job.attempts + 1;
    const t0 = Date.now();
    this.db.prepare("UPDATE jobs SET status = 'running', attempts = ?, progress = 0, started_at = COALESCE(started_at, ?) WHERE film_id = ? AND id = ?").run(attempt, t0, filmId, job.id);
    logActivity(this.db, { filmId, kind: "job", name: job.id, status: "info", summary: `${cap(describeJob(job.kind, job.target))} started (attempt ${attempt}, key ${job.idemKey})`, detail: { idemKey: job.idemKey, attempt } });

    const total = (1000 + this.random() * 2000) * this.scale;
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      await sleep(total / steps);
      this.db.prepare("UPDATE jobs SET progress = ? WHERE film_id = ? AND id = ?").run(i / steps, filmId, job.id);
    }

    try {
      if (job.attempts === 0 && attempt === 1 && this.db.prepare("SELECT fail_first FROM jobs WHERE film_id = ? AND id = ?").pluck().get(filmId, job.id) === 1) {
        throw new ProviderError(SIMULATED_TIMEOUT);
      }
      const assetId = renderJob(this.db, filmId, job);
      const tx = this.db.transaction(() => {
        this.db.prepare("UPDATE jobs SET status = 'done', progress = 1, asset_id = ?, finished_at = ? WHERE film_id = ? AND id = ?").run(assetId, Date.now(), filmId, job.id);
        addEntry(this.db, { filmId, kind: "charge", amount: job.price, jobId: job.id, quoteId: job.quoteId, note: `Charge for ${describeJob(job.kind, job.target)}${attempt > 1 ? ` (succeeded on attempt ${attempt}, charged once)` : ""}` });
        if (job.kind === "reference") {
          this.db.prepare("UPDATE looks SET status = 'pending', asset_id = ? WHERE film_id = ? AND job_id = ?").run(assetId, filmId, job.id);
        }
      });
      tx();
      logActivity(this.db, { filmId, kind: "job", name: job.id, status: "ok", durationMs: Date.now() - t0, credits: job.price, summary: `${cap(describeJob(job.kind, job.target))} done${attempt > 1 ? ` on attempt ${attempt}` : ""}, charged ${job.price} cr` });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const errors = [...job.errors, { attempt, message, at: Date.now() }];
      if (attempt < MAX_ATTEMPTS) {
        const backoff = 500 * 2 ** (attempt - 1) * this.scale;
        this.db.prepare("UPDATE jobs SET status = 'retrying', errors = ?, progress = 0, next_attempt_at = ? WHERE film_id = ? AND id = ?").run(JSON.stringify(errors), Date.now() + backoff, filmId, job.id);
        logActivity(this.db, { filmId, kind: "job", name: job.id, status: "error", durationMs: Date.now() - t0, summary: `Attempt ${attempt} failed: ${message}. Retrying on the same key ${job.idemKey}` });
      } else {
        const tx = this.db.transaction(() => {
          this.db.prepare("UPDATE jobs SET status = 'failed', errors = ?, finished_at = ? WHERE film_id = ? AND id = ?").run(JSON.stringify(errors), Date.now(), filmId, job.id);
          addEntry(this.db, { filmId, kind: "release", amount: job.price, jobId: job.id, quoteId: job.quoteId, note: `Released hold: ${describeJob(job.kind, job.target)} failed` });
          if (job.kind === "reference") this.db.prepare("UPDATE looks SET status = 'failed' WHERE film_id = ? AND job_id = ?").run(filmId, job.id);
        });
        tx();
        logActivity(this.db, { filmId, kind: "job", name: job.id, status: "error", durationMs: Date.now() - t0, summary: `Failed after ${attempt} attempts: ${message}. Hold released` });
      }
    }
  }
}

export class ProviderError extends Error {}

/** Draws the SVG for a finished job and stores it. */
export function renderJob(db: DB, filmId: string, job: JobRow): string {
  const film = getFilm(db, filmId);
  const palette = film.look?.palette ?? DEFAULT_PALETTE;
  const elements = new Map(listElements(db, filmId).map((e) => [e.id, e]));
  const looks = listLooks(db, filmId);
  if (job.kind === "reference") {
    const el = elements.get(job.target);
    if (!el) throw new ProviderError(`element ${job.target} was removed`);
    const version = Number(job.params.version ?? 1);
    const note = (job.params.note as string | null) ?? null;
    const svg = renderReference(toRenderElement(el, version, note), palette);
    return saveAsset(db, filmId, "reference", svg, { elementId: el.id, version, note });
  }
  const scene = listScenes(db, filmId).find((s) => String(s.n) === job.target);
  if (!scene) throw new ProviderError(`scene ${job.target} was removed`);
  if (job.kind === "frame") {
    const versions = (job.params.lookVersions as Record<string, number>) ?? {};
    const parts = scene.elementIds.flatMap((id) => {
      const el = elements.get(id);
      if (!el) return [];
      const look = looks.find((l) => l.elementId === id && l.version === versions[id]);
      return [toRenderElement(el, versions[id] ?? 1, look?.note && look.source === "render" ? look.note : null)];
    });
    const svg = renderFrame({ aspect: film.aspect, palette, heading: scene.heading, sceneN: scene.n, elements: parts });
    return saveAsset(db, filmId, "frame", svg, { scene: scene.n, lookVersions: versions });
  }
  // A clip is its frame plus a camera move; the player animates it.
  const frameAssetId = String(job.params.frameAssetId ?? "");
  const frame = db.prepare("SELECT svg FROM assets WHERE id = ?").get(frameAssetId) as { svg: string } | undefined;
  if (!frame) throw new ProviderError("source frame is missing");
  return saveAsset(db, filmId, "clip", frame.svg, { scene: scene.n, frameAssetId, move: job.params.move, seconds: job.seconds, resolution: job.resolution, lookVersions: job.params.lookVersions });
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
