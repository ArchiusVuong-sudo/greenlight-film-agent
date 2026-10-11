import { randomBytes } from "node:crypto";
import { allocate, priceRequest, PricingError, type PriceLine, type PricedLine } from "./catalog";
import { json, nextId, type DB } from "./db";
import { cutLength, runExportChecks, type ExportClip } from "./exportChecks";
import { addEntry, accountBalance, costPerUsableShot, filmMoney, type FilmMoney } from "./ledger";
import { LIBRARY } from "./library";
import { DEFAULT_PALETTE, saveAsset, toRenderElement } from "./assets";
import { renderReference } from "./render/svg";
import { runPlanChecks, type PlanScene } from "./planChecks";
import type {
  Aspect,
  CameraMove,
  CheckResult,
  CutItem,
  Decision,
  DecisionAnswer,
  DecisionKind,
  DecisionOption,
  ElementInput,
  ElementRow,
  Film,
  FilmSpec,
  JobKind,
  JobRow,
  Look,
  LookRow,
  Resolution,
  SceneInput,
} from "./types";
import { sceneSchema } from "./types";

export class StudioError extends Error {}

export const QUOTE_TTL_MS = 10 * 60 * 1000;

/* ------------------------------------------------------------------ films */

interface FilmDbRow {
  id: string;
  brief_id: string | null;
  brief: string;
  target_sec: number;
  aspect: Aspect;
  resolution: Resolution;
  budget: number;
  simulate_timeout: number;
  title: string | null;
  logline: string | null;
  look: string | null;
  checks: string | null;
  cut: string | null;
  created_at: number;
}

function toFilm(r: FilmDbRow): Film {
  return {
    id: r.id,
    briefId: r.brief_id,
    brief: r.brief,
    targetSec: r.target_sec,
    aspect: r.aspect,
    resolution: r.resolution,
    budget: r.budget,
    simulateTimeout: !!r.simulate_timeout,
    title: r.title,
    logline: r.logline,
    look: json<Look | null>(r.look, null),
    createdAt: r.created_at,
  };
}

export function createFilm(db: DB, spec: FilmSpec): Film {
  const id = `film-${randomBytes(4).toString("hex")}`;
  db.prepare(
    "INSERT INTO films (id, brief_id, brief, target_sec, aspect, resolution, budget, simulate_timeout, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, spec.briefId ?? null, spec.brief, spec.targetSec, spec.aspect, spec.resolution, spec.budget, spec.simulateTimeout ? 1 : 0, Date.now());
  return getFilm(db, id);
}

export function getFilm(db: DB, id: string): Film {
  const r = db.prepare("SELECT * FROM films WHERE id = ?").get(id) as FilmDbRow | undefined;
  if (!r) throw new StudioError(`Film ${id} not found`);
  return toFilm(r);
}

export function listFilms(db: DB): Film[] {
  return (db.prepare("SELECT * FROM films ORDER BY created_at DESC LIMIT 20").all() as FilmDbRow[]).map(toFilm);
}

export function setProject(db: DB, filmId: string, p: { title: string; logline: string; look: Look }): void {
  getFilm(db, filmId);
  db.prepare("UPDATE films SET title = ?, logline = ?, look = ? WHERE id = ?").run(p.title, p.logline, JSON.stringify(p.look), filmId);
}

/* --------------------------------------------------------------- elements */

export function listElements(db: DB, filmId: string): ElementRow[] {
  return db.prepare("SELECT id, kind, name, description FROM elements WHERE film_id = ? ORDER BY CASE kind WHEN 'cast' THEN 0 WHEN 'location' THEN 1 ELSE 2 END, rowid").all(filmId) as ElementRow[];
}

export function upsertElements(db: DB, filmId: string, elements: ElementInput[]): CheckResult[] {
  getFilm(db, filmId);
  const tx = db.transaction(() => {
    const st = db.prepare(
      "INSERT INTO elements (film_id, id, kind, name, description, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(film_id, id) DO UPDATE SET kind = excluded.kind, name = excluded.name, description = excluded.description, updated_at = excluded.updated_at",
    );
    for (const e of elements) st.run(filmId, e.id, e.kind, e.name, e.description, Date.now());
  });
  tx();
  return recomputePlanChecks(db, filmId);
}

/* ----------------------------------------------------------------- scenes */

export interface SceneRow extends PlanScene {
  cameraMove: CameraMove;
}

export function listScenes(db: DB, filmId: string): SceneRow[] {
  const rows = db.prepare("SELECT * FROM scenes WHERE film_id = ? ORDER BY n").all(filmId) as {
    n: number;
    heading: string;
    action: string;
    dialogue: string;
    duration_sec: number;
    element_ids: string;
    camera_move: CameraMove;
  }[];
  return rows.map((r) => ({
    n: r.n,
    heading: r.heading,
    action: r.action,
    dialogue: json(r.dialogue, []),
    durationSec: r.duration_sec,
    elementIds: json(r.element_ids, []),
    cameraMove: r.camera_move,
  }));
}

/** Replaces the whole scene list (the model always sends the full plan). */
export function writeScenes(db: DB, filmId: string, scenes: SceneInput[]): CheckResult[] {
  getFilm(db, filmId);
  const parsed = scenes.map((s) => sceneSchema.parse(s));
  const nums = new Set<number>();
  for (const s of parsed) {
    if (nums.has(s.n)) throw new StudioError(`Scene number ${s.n} is used twice`);
    nums.add(s.n);
  }
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM scenes WHERE film_id = ?").run(filmId);
    const st = db.prepare(
      "INSERT INTO scenes (film_id, n, heading, action, dialogue, duration_sec, element_ids, camera_move) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const s of parsed) st.run(filmId, s.n, s.heading.trim(), s.action, JSON.stringify(s.dialogue), s.durationSec, JSON.stringify(s.elementIds), s.cameraMove);
  });
  tx();
  return recomputePlanChecks(db, filmId);
}

export function recomputePlanChecks(db: DB, filmId: string): CheckResult[] {
  const film = getFilm(db, filmId);
  const prevRow = db.prepare("SELECT checks FROM films WHERE id = ?").get(filmId) as { checks: string | null };
  const checks = runPlanChecks(film.targetSec, listScenes(db, filmId), listElements(db, filmId), json(prevRow.checks, []));
  db.prepare("UPDATE films SET checks = ? WHERE id = ?").run(JSON.stringify(checks), filmId);
  return checks;
}

export function planChecks(db: DB, filmId: string): CheckResult[] {
  const row = db.prepare("SELECT checks FROM films WHERE id = ?").get(filmId) as { checks: string | null } | undefined;
  return json(row?.checks, []);
}

/* ------------------------------------------------------------------ looks */

export function listLooks(db: DB, filmId: string): LookRow[] {
  const rows = db.prepare("SELECT * FROM looks WHERE film_id = ? ORDER BY element_id, version").all(filmId) as {
    element_id: string;
    version: number;
    status: LookRow["status"];
    source: LookRow["source"];
    asset_id: string | null;
    job_id: string | null;
    note: string | null;
    credits: number;
    created_at: number;
  }[];
  return rows.map((r) => ({
    elementId: r.element_id,
    version: r.version,
    status: r.status,
    source: r.source,
    assetId: r.asset_id,
    jobId: r.job_id,
    note: r.note,
    credits: r.credits,
    createdAt: r.created_at,
  }));
}

export function latestLooks(db: DB, filmId: string): Map<string, LookRow> {
  const out = new Map<string, LookRow>();
  for (const l of listLooks(db, filmId)) out.set(l.elementId, l);
  return out;
}

/** Current approved (or reused) look version per element. */
export function approvedLookVersions(db: DB, filmId: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, l] of latestLooks(db, filmId)) if (l.status === "approved" || l.status === "reused") out[id] = l.version;
  return out;
}

/* ---------------------------------------------------------------- library */

export function searchLibrary(query: string, kind?: string) {
  const words = query.toLowerCase().match(/[a-z]+/g) ?? [];
  return LIBRARY.filter((item) => !kind || item.kind === kind)
    .map((item) => {
      const hay = `${item.name} ${item.tags.join(" ")} ${item.description}`.toLowerCase();
      const score = words.filter((w) => w.length > 2 && hay.includes(w)).length;
      return { ...item, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ id, kind: k, name, description, score }) => ({ assetId: id, kind: k, name, description, matchScore: score, credits: 0 }));
}

export function attachLibraryAsset(db: DB, filmId: string, elementId: string, assetId: string): LookRow {
  const el = listElements(db, filmId).find((e) => e.id === elementId);
  if (!el) throw new StudioError(`Element ${elementId} does not exist. Call upsertElements first.`);
  const item = LIBRARY.find((l) => l.id === assetId);
  if (!item) throw new StudioError(`Library asset ${assetId} does not exist. Use an assetId from searchLibrary.`);
  if (item.kind !== el.kind) throw new StudioError(`${assetId} is a ${item.kind}, ${elementId} is a ${el.kind}`);
  const latest = latestLooks(db, filmId).get(elementId);
  if (latest && (latest.status === "approved" || latest.status === "reused")) return latest;
  const version = (latest?.version ?? 0) + 1;
  const asset = saveLibraryAsset(db, filmId, el, item.id, version);
  db.prepare(
    "INSERT INTO looks (film_id, element_id, version, status, source, asset_id, job_id, note, credits, created_at) VALUES (?, ?, ?, 'reused', 'library', ?, NULL, ?, 0, ?)",
  ).run(filmId, elementId, version, asset, `Reused from library: ${item.name}`, Date.now());
  return latestLooks(db, filmId).get(elementId)!;
}

function saveLibraryAsset(db: DB, filmId: string, el: ElementRow, libId: string, version: number): string {
  const item = LIBRARY.find((l) => l.id === libId)!;
  const film = getFilm(db, filmId);
  const palette = film.look?.palette ?? DEFAULT_PALETTE;
  const svg = renderReference({ ...toRenderElement(el, version, null), description: `${item.name}. ${item.description}`, name: el.name }, palette);
  return saveAsset(db, filmId, "reference", svg, { elementId: el.id, version, libraryId: libId });
}

/* ------------------------------------------------------------------- jobs */

interface JobDbRow {
  id: string;
  film_id: string;
  kind: JobKind;
  target: string;
  idem_key: string;
  model: string;
  resolution: Resolution | null;
  seconds: number | null;
  ref_inputs: number;
  price: number;
  status: JobRow["status"];
  attempts: number;
  progress: number;
  fail_first: number;
  errors: string;
  params: string;
  asset_id: string | null;
  quote_id: string | null;
  run_id: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export function toJob(r: JobDbRow): JobRow {
  return {
    id: r.id,
    kind: r.kind,
    target: r.target,
    idemKey: r.idem_key,
    model: r.model,
    resolution: r.resolution,
    seconds: r.seconds,
    refInputs: r.ref_inputs,
    price: r.price,
    status: r.status,
    attempts: r.attempts,
    progress: r.progress,
    errors: json(r.errors, []),
    params: json(r.params, {}),
    assetId: r.asset_id,
    quoteId: r.quote_id,
    runId: r.run_id,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

export function listJobs(db: DB, filmId: string): JobRow[] {
  return (db.prepare("SELECT * FROM jobs WHERE film_id = ? ORDER BY created_at, rowid").all(filmId) as JobDbRow[]).map(toJob);
}

export function getJob(db: DB, filmId: string, jobId: string): JobRow | undefined {
  const r = db.prepare("SELECT * FROM jobs WHERE film_id = ? AND id = ?").get(filmId, jobId) as JobDbRow | undefined;
  return r ? toJob(r) : undefined;
}

/* ------------------------------------------------------- render requests */

export type RenderRequest =
  | { kind: "reference"; elementIds: string[]; model: string }
  | { kind: "frame"; scenes: number[]; model: string }
  | { kind: "clip"; scenes: number[]; model: string; resolution: Resolution };

interface JobSpec {
  kind: JobKind;
  target: string;
  idemKey: string;
  model: string;
  resolution: Resolution | null;
  seconds: number | null;
  refInputs: number;
  params: Record<string, unknown>;
  exact: number;
  price: number;
}

export interface ReusedJob {
  jobId: string;
  idemKey: string;
  status: string;
}

export type RenderOutcome =
  | { status: "queued"; jobs: { jobId: string; target: string; idemKey: string; holdCredits: number }[]; reused: ReusedJob[]; total: number; money: FilmMoney }
  | { status: "refused"; reason: "budget"; quoteId: string; total: number; lines: QuoteLine[]; money: FilmMoney; message: string }
  | { status: "refused"; reason: "looks" | "order" | "balance"; message: string; missing: string[] };

export interface QuoteLine {
  target: string;
  kind: JobKind;
  model: string;
  unit: string;
  exact: number;
  hold: number;
}

/** Builds job specs for a request; does not write anything. */
function planJobs(db: DB, filmId: string, req: RenderRequest): { specs: JobSpec[]; reused: ReusedJob[]; blocked: string[]; blockReason: "looks" | "order" | null } {
  const film = getFilm(db, filmId);
  const elements = new Map(listElements(db, filmId).map((e) => [e.id, e]));
  const scenes = new Map(listScenes(db, filmId).map((s) => [s.n, s]));
  const looks = latestLooks(db, filmId);
  const jobs = listJobs(db, filmId);
  const byKey = new Map(jobs.map((j) => [j.idemKey, j]));
  const approved = approvedLookVersions(db, filmId);
  const specs: JobSpec[] = [];
  const reused: ReusedJob[] = [];
  const blocked: string[] = [];
  let blockReason: "looks" | "order" | null = null;
  const lines: PriceLine[] = [];
  const pending: Omit<JobSpec, "exact" | "price">[] = [];

  const push = (spec: Omit<JobSpec, "exact" | "price">) => {
    const existing = byKey.get(spec.idemKey);
    if (existing && existing.status !== "failed") {
      reused.push({ jobId: existing.id, idemKey: existing.idemKey, status: existing.status });
      return;
    }
    if (existing) spec.idemKey = `${spec.idemKey}:retry${jobs.filter((j) => j.idemKey.startsWith(spec.idemKey)).length}`;
    pending.push(spec);
    lines.push({ kind: spec.kind, target: spec.target, model: spec.model, resolution: spec.resolution ?? undefined, seconds: spec.seconds ?? undefined, refInputs: spec.refInputs });
  };

  if (req.kind === "reference") {
    for (const id of unique(req.elementIds)) {
      const el = elements.get(id);
      if (!el) throw new StudioError(`Element ${id} does not exist`);
      const latest = looks.get(id);
      if (latest && (latest.status === "approved" || latest.status === "reused")) {
        reused.push({ jobId: latest.jobId ?? `look:${id}`, idemKey: `ref:${id}:v${latest.version}`, status: latest.status });
        continue;
      }
      const version = latest && (latest.status === "rejected" || latest.status === "failed") ? latest.version + 1 : latest?.version ?? 1;
      const note = latest?.status === "rejected" ? latest.note : latest && latest.version === version ? latest.note : null;
      push({ kind: "reference", target: id, idemKey: `ref:${id}:v${version}`, model: req.model, resolution: null, seconds: null, refInputs: 0, params: { version, note } });
    }
  } else if (req.kind === "frame") {
    for (const n of unique(req.scenes)) {
      const s = scenes.get(n);
      if (!s) throw new StudioError(`Scene ${n} does not exist`);
      const missing = s.elementIds.filter((id) => approved[id] === undefined);
      if (missing.length) {
        blocked.push(...missing.map((m) => `scene ${n}: ${m}`));
        blockReason = "looks";
        continue;
      }
      const lookVersions = Object.fromEntries(s.elementIds.map((id) => [id, approved[id]!]));
      const sig = s.elementIds.map((id) => `${id}@${approved[id]}`).join(",");
      push({ kind: "frame", target: String(n), idemKey: `frame:s${n}:${req.model}:${sig}`, model: req.model, resolution: null, seconds: null, refInputs: s.elementIds.length, params: { lookVersions } });
    }
  } else {
    for (const n of unique(req.scenes)) {
      const s = scenes.get(n);
      if (!s) throw new StudioError(`Scene ${n} does not exist`);
      const frame = [...jobs].reverse().find((j) => j.kind === "frame" && j.target === String(n) && j.status === "done");
      const currentLooks = s.elementIds.every((id) => (frame?.params.lookVersions as Record<string, number> | undefined)?.[id] === approved[id]);
      if (!frame || !currentLooks) {
        blocked.push(`scene ${n}: no finished frame with the approved looks`);
        blockReason = blockReason ?? "order";
        continue;
      }
      push({
        kind: "clip",
        target: String(n),
        idemKey: `clip:s${n}:${req.model}:${req.resolution}:${frame.id}`,
        model: req.model,
        resolution: req.resolution,
        seconds: s.durationSec,
        refInputs: 1,
        params: { frameJobId: frame.id, frameAssetId: frame.assetId, lookVersions: frame.params.lookVersions, move: s.cameraMove, aspect: film.aspect },
      });
    }
  }

  const priced = priceRequest(lines);
  const holds = allocate(priced.lines.map((l) => l.exact), priced.total);
  pending.forEach((p, i) => specs.push({ ...p, exact: priced.lines[i]!.exact, price: holds[i]! }));
  return { specs, reused, blocked, blockReason };
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/** Prices a request against the film budget without writing anything. */
export function estimate(db: DB, filmId: string, reqs: RenderRequest[]) {
  const film = getFilm(db, filmId);
  const lines: (QuoteLine & { note?: string })[] = [];
  const skipped: string[] = [];
  const allExact: number[] = [];
  for (const req of reqs) {
    const { specs, reused } = planJobsForEstimate(db, filmId, req);
    for (const s of specs) {
      lines.push({ target: s.target, kind: s.kind, model: s.model, unit: s.unit, exact: round2(s.exact), hold: 0 });
      allExact.push(s.exact);
    }
    skipped.push(...reused);
  }
  const total = Math.ceil(allExact.reduce((a, b) => a + b, 0) - 1e-9);
  const money = filmMoney(db, filmId, film.budget);
  return { lines, total, money, fits: total <= money.remaining, alreadyCovered: skipped };
}

/**
 * Estimates ignore the generation order (a frame can be priced before its looks are approved),
 * so they price from the plan directly instead of from planJobs.
 */
function planJobsForEstimate(db: DB, filmId: string, req: RenderRequest): { specs: (PricedLine & { target: string })[]; reused: string[] } {
  const scenes = new Map(listScenes(db, filmId).map((s) => [s.n, s]));
  const looks = latestLooks(db, filmId);
  const elements = new Set(listElements(db, filmId).map((e) => e.id));
  const lines: PriceLine[] = [];
  const reused: string[] = [];
  if (req.kind === "reference") {
    for (const id of unique(req.elementIds)) {
      if (!elements.has(id)) throw new StudioError(`Element ${id} does not exist`);
      const l = looks.get(id);
      if (l && (l.status === "approved" || l.status === "reused" || l.status === "pending" || l.status === "rendering")) {
        reused.push(`${id} (${l.status === "reused" ? "reused from library, 0 cr" : `look ${l.status}`})`);
        continue;
      }
      lines.push({ kind: "reference", target: id, model: req.model, refInputs: 0 });
    }
  } else {
    for (const n of unique(req.scenes)) {
      const s = scenes.get(n);
      if (!s) throw new StudioError(`Scene ${n} does not exist`);
      if (req.kind === "frame") lines.push({ kind: "frame", target: String(n), model: req.model, refInputs: s.elementIds.length });
      else lines.push({ kind: "clip", target: String(n), model: req.model, resolution: req.resolution, seconds: s.durationSec, refInputs: 1 });
    }
  }
  return { specs: priceRequest(lines).lines.map((l) => ({ ...l })), reused };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * The spend gate. Inside the budget: jobs are queued with holds. Outside it: a single-use quote
 * that expires in 10 minutes is created and nothing is queued. Frames wait for approved looks.
 */
export function requestRenders(db: DB, filmId: string, req: RenderRequest, opts: { runId?: string | null } = {}): RenderOutcome {
  const film = getFilm(db, filmId);
  let plan;
  try {
    plan = planJobs(db, filmId, req);
  } catch (e) {
    if (e instanceof PricingError) throw new StudioError(e.message);
    throw e;
  }
  const { specs, reused, blocked, blockReason } = plan;
  if (blockReason && specs.length === 0) {
    const message =
      blockReason === "looks"
        ? `Refused: these looks are not approved yet: ${blocked.join("; ")}. Only the director can approve looks. Call askDirector with kind "look".`
        : `Refused: ${blocked.join("; ")}. Render and wait for the frames first.`;
    return { status: "refused", reason: blockReason, message, missing: blocked };
  }
  const total = specs.reduce((a, s) => a + s.price, 0);
  const money = filmMoney(db, filmId, film.budget);
  if (total > money.remaining) {
    const quoteId = createQuote(db, filmId, req, specs);
    const lines = specs.map((s) => ({ target: s.target, kind: s.kind, model: s.model, unit: "", exact: round2(s.exact), hold: s.price }));
    return {
      status: "refused",
      reason: "budget",
      quoteId,
      total,
      lines,
      money,
      message: `Refused: this request costs ${total} cr and only ${money.remaining} cr of the ${film.budget} cr budget is left. Nothing was queued. Quote ${quoteId} holds this exact request for 10 minutes. Call askDirector next with kind "budget" and quoteId "${quoteId}".`,
    };
  }
  if (total > accountBalance(db).available) {
    return { status: "refused", reason: "balance", message: "Refused: the demo account balance is too low.", missing: [] };
  }
  const queued = insertJobs(db, filmId, specs, { runId: opts.runId ?? null, quoteId: null, simulateTimeout: film.simulateTimeout });
  return { status: "queued", jobs: queued, reused, total, money: filmMoney(db, filmId, film.budget) };
}

function insertJobs(
  db: DB,
  filmId: string,
  specs: JobSpec[],
  o: { runId: string | null; quoteId: string | null; simulateTimeout: boolean },
): { jobId: string; target: string; idemKey: string; holdCredits: number }[] {
  const out: { jobId: string; target: string; idemKey: string; holdCredits: number }[] = [];
  const tx = db.transaction(() => {
    for (const s of specs) {
      const existing = db.prepare("SELECT id FROM jobs WHERE film_id = ? AND idem_key = ?").get(filmId, s.idemKey) as { id: string } | undefined;
      if (existing) continue; // same key: return nothing new, add no hold
      const id = nextId(db, filmId, "J");
      const isFirstClip = s.kind === "clip" && !(db.prepare("SELECT 1 FROM jobs WHERE film_id = ? AND kind = 'clip'").get(filmId) as unknown);
      db.prepare(
        `INSERT INTO jobs (id, film_id, kind, target, idem_key, model, resolution, seconds, ref_inputs, price, status, fail_first, params, quote_id, run_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)`,
      ).run(id, filmId, s.kind, s.target, s.idemKey, s.model, s.resolution, s.seconds, s.refInputs, s.price, o.simulateTimeout && isFirstClip ? 1 : 0, JSON.stringify(s.params), o.quoteId, o.runId, Date.now());
      addEntry(db, { filmId, kind: "hold", amount: s.price, jobId: id, quoteId: o.quoteId, note: `Hold for ${describeJob(s.kind, s.target)} (${s.model})` });
      if (s.kind === "reference") {
        const version = Number(s.params.version);
        db.prepare(
          "INSERT INTO looks (film_id, element_id, version, status, source, asset_id, job_id, note, credits, created_at) VALUES (?, ?, ?, 'rendering', 'render', NULL, ?, ?, ?, ?) ON CONFLICT(film_id, element_id, version) DO UPDATE SET status = 'rendering', job_id = excluded.job_id",
        ).run(filmId, s.target, version, id, (s.params.note as string | null) ?? null, s.price, Date.now());
      }
      out.push({ jobId: id, target: s.target, idemKey: s.idemKey, holdCredits: s.price });
    }
  });
  tx();
  return out;
}

export function describeJob(kind: JobKind, target: string): string {
  return kind === "reference" ? `look for ${target}` : kind === "frame" ? `frame for scene ${target}` : `clip for scene ${target}`;
}

/* ----------------------------------------------------------------- quotes */

function createQuote(db: DB, filmId: string, req: RenderRequest, specs: JobSpec[]): string {
  const id = nextId(db, filmId, "Q");
  const total = specs.reduce((a, s) => a + s.price, 0);
  db.prepare("INSERT INTO quotes (id, film_id, tool, request, lines, total, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)").run(
    id,
    filmId,
    req.kind,
    JSON.stringify(req),
    JSON.stringify(specs),
    total,
    Date.now() + QUOTE_TTL_MS,
    Date.now(),
  );
  return id;
}

export interface QuoteRow {
  id: string;
  kind: string;
  request: RenderRequest;
  specs: JobSpec[];
  total: number;
  status: "open" | "used" | "expired" | "declined";
  expiresAt: number;
}

export function getQuote(db: DB, filmId: string, quoteId: string): QuoteRow | undefined {
  const r = db.prepare("SELECT * FROM quotes WHERE film_id = ? AND id = ?").get(filmId, quoteId) as
    | { id: string; tool: string; request: string; lines: string; total: number; status: QuoteRow["status"]; expires_at: number }
    | undefined;
  if (!r) return undefined;
  const status = r.status === "open" && Date.now() > r.expires_at ? "expired" : r.status;
  return { id: r.id, kind: r.tool, request: json(r.request, {} as RenderRequest), specs: json(r.lines, []), total: r.total, status, expiresAt: r.expires_at };
}

/** Approving a quote queues exactly the quoted renders, once. */
export function approveQuote(db: DB, filmId: string, quoteId: string, runId: string | null): { jobs: { jobId: string; target: string }[]; total: number } {
  const film = getFilm(db, filmId);
  const q = getQuote(db, filmId, quoteId);
  if (!q) throw new StudioError(`Quote ${quoteId} does not exist`);
  if (q.status === "used") throw new StudioError(`Quote ${quoteId} was already used`);
  if (q.status === "expired") throw new StudioError(`Quote ${quoteId} expired. Ask the assistant for a new one.`);
  if (q.status !== "open") throw new StudioError(`Quote ${quoteId} is ${q.status}`);
  let jobs: { jobId: string; target: string }[] = [];
  const tx = db.transaction(() => {
    db.prepare("UPDATE quotes SET status = 'used' WHERE film_id = ? AND id = ?").run(filmId, quoteId);
    jobs = insertJobs(db, filmId, q.specs, { runId, quoteId, simulateTimeout: film.simulateTimeout });
  });
  tx();
  return { jobs, total: q.total };
}

export function declineQuote(db: DB, filmId: string, quoteId: string): void {
  db.prepare("UPDATE quotes SET status = 'declined' WHERE film_id = ? AND id = ? AND status = 'open'").run(filmId, quoteId);
}

/* -------------------------------------------------------------- decisions */

interface DecisionDbRow {
  id: string;
  kind: DecisionKind;
  message: string;
  payload: string;
  status: Decision["status"];
  answer: string | null;
  opened_by: Decision["openedBy"];
  created_at: number;
  answered_at: number | null;
}

function toDecision(r: DecisionDbRow): Decision {
  return {
    id: r.id,
    kind: r.kind,
    message: r.message,
    status: r.status,
    openedBy: r.opened_by,
    payload: json(r.payload, {}),
    answer: json(r.answer, null),
    createdAt: r.created_at,
    answeredAt: r.answered_at,
  };
}

export function listDecisions(db: DB, filmId: string): Decision[] {
  return (db.prepare("SELECT * FROM decisions WHERE film_id = ? ORDER BY created_at, rowid").all(filmId) as DecisionDbRow[]).map(toDecision);
}

export function openDecisions(db: DB, filmId: string): Decision[] {
  return listDecisions(db, filmId).filter((d) => d.status === "open");
}

export function openDecision(
  db: DB,
  filmId: string,
  runId: string | null,
  d: { kind: DecisionKind; message: string; elementIds?: string[]; options?: DecisionOption[]; quoteId?: string },
  openedBy: "assistant" | "server" = "assistant",
): Decision {
  const payload: Decision["payload"] = {};
  if (d.kind === "look") {
    const looks = latestLooks(db, filmId);
    const ids = (d.elementIds?.length ? d.elementIds : [...looks.keys()]).filter((id) => looks.get(id)?.status === "pending");
    if (ids.length === 0) throw new StudioError("No looks are waiting for approval. Render references and wait for them first.");
    payload.elementIds = ids;
  } else {
    const options = [...(d.options ?? [])];
    if (d.quoteId) {
      const q = getQuote(db, filmId, d.quoteId);
      if (!q) throw new StudioError(`Quote ${d.quoteId} does not exist`);
      if (q.status !== "open") throw new StudioError(`Quote ${d.quoteId} is ${q.status}`);
      payload.quoteId = d.quoteId;
      if (!options.some((o) => o.id === "approve-quote")) {
        options.unshift({ id: "approve-quote", label: `Approve quote ${q.id}: spend ${q.total} cr over the budget`, detail: `Queues exactly the ${q.specs.length} quoted renders`, estimateCredits: q.total });
      }
    }
    if (options.length === 0) throw new StudioError("A budget or question card needs at least one option.");
    const ids = new Set<string>();
    for (const o of options) {
      if (ids.has(o.id)) throw new StudioError(`Option id ${o.id} is used twice`);
      ids.add(o.id);
    }
    payload.options = options;
  }
  // One open card of each kind at a time: a newer card replaces the older one.
  db.prepare("UPDATE decisions SET status = 'cancelled' WHERE film_id = ? AND kind = ? AND status = 'open'").run(filmId, d.kind);
  const id = nextId(db, filmId, "D");
  db.prepare("INSERT INTO decisions (id, film_id, run_id, kind, message, payload, status, opened_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)").run(
    id,
    filmId,
    runId,
    d.kind,
    d.message,
    JSON.stringify(payload),
    openedBy,
    Date.now(),
  );
  return listDecisions(db, filmId).find((x) => x.id === id)!;
}

/** Applies a director answer and returns the message the assistant receives. */
export function answerDecision(db: DB, filmId: string, decisionId: string, answer: DecisionAnswer): string {
  const d = listDecisions(db, filmId).find((x) => x.id === decisionId);
  if (!d) throw new StudioError(`Card ${decisionId} does not exist`);
  if (d.status !== "open") throw new StudioError(`Card ${decisionId} is already ${d.status}`);
  let message = "";
  const tx = db.transaction(() => {
    if (d.kind === "look") {
      if (answer.kind !== "look") throw new StudioError("A look card needs a verdict per look");
      const looks = latestLooks(db, filmId);
      const want = new Set(d.payload.elementIds ?? []);
      const got = new Set(answer.looks.map((l) => l.elementId));
      for (const id of want) if (!got.has(id)) throw new StudioError(`Missing a verdict for ${id}`);
      const approved: string[] = [];
      const redo: string[] = [];
      for (const v of answer.looks) {
        const l = looks.get(v.elementId);
        if (!l || !want.has(v.elementId)) throw new StudioError(`${v.elementId} is not on this card`);
        if (v.verdict === "approve") {
          db.prepare("UPDATE looks SET status = 'approved' WHERE film_id = ? AND element_id = ? AND version = ?").run(filmId, v.elementId, l.version);
          approved.push(`${v.elementId} (take ${l.version})`);
        } else {
          const note = v.note?.trim() || "Try again";
          db.prepare("UPDATE looks SET status = 'rejected', note = ? WHERE film_id = ? AND element_id = ? AND version = ?").run(note, filmId, v.elementId, l.version);
          redo.push(`${v.elementId} (take ${l.version}) with the note "${note}"`);
        }
      }
      message = [
        `Director answered look card ${d.id}.`,
        approved.length ? `Approved: ${approved.join(", ")}.` : "",
        redo.length ? `Redo: ${redo.join("; ")}. Update those element descriptions to follow the note, render their references again, wait, and ask for look approval again.` : "All looks on the card are approved.",
      ]
        .filter(Boolean)
        .join(" ");
    } else {
      if (answer.kind !== "option") throw new StudioError("Pick one option");
      const opt = d.payload.options?.find((o) => o.id === answer.optionId);
      if (!opt) throw new StudioError(`Option ${answer.optionId} is not on card ${d.id}`);
      const note = answer.note?.trim() ? ` Note from the director: "${answer.note.trim()}".` : "";
      if (opt.id === "approve-quote" && d.payload.quoteId) {
        const owner = db.prepare("SELECT run_id FROM decisions WHERE film_id = ? AND id = ?").get(filmId, d.id) as { run_id: string | null } | undefined;
        const res = approveQuote(db, filmId, d.payload.quoteId, owner?.run_id ?? null);
        message = `Director approved quote ${d.payload.quoteId} (${res.total} cr). Queued exactly the quoted renders: ${res.jobs.map((j) => j.jobId).join(", ") || "none new"}. Wait for them, then carry on.${note}`;
      } else {
        if (d.payload.quoteId) declineQuote(db, filmId, d.payload.quoteId);
        message = `Director picked "${opt.label}" (option ${opt.id}) on ${d.kind} card ${d.id}.${note} Carry on with that choice.`;
      }
    }
    db.prepare("UPDATE decisions SET status = 'answered', answer = ?, answered_at = ? WHERE film_id = ? AND id = ?").run(JSON.stringify(answer), Date.now(), filmId, d.id);
  });
  tx();
  return message;
}

/* -------------------------------------------------------------------- cut */

export function getCut(db: DB, filmId: string): CutItem[] | null {
  const r = db.prepare("SELECT cut FROM films WHERE id = ?").get(filmId) as { cut: string | null } | undefined;
  return json<CutItem[] | null>(r?.cut, null);
}

function doneClips(db: DB, filmId: string): ExportClip[] {
  return listJobs(db, filmId)
    .filter((j) => j.kind === "clip" && j.status === "done")
    .map((j) => ({ jobId: j.id, scene: Number(j.target), seconds: j.seconds ?? 0, lookVersions: (j.params.lookVersions as Record<string, number>) ?? {} }));
}

/** Puts the newest finished clip of each scene in scene order (preferring clips with the current looks). */
export function assembleCut(db: DB, filmId: string): { cut: CutItem[]; checks: CheckResult[]; lengthSec: number } {
  const scenes = listScenes(db, filmId);
  const approved = approvedLookVersions(db, filmId);
  const clips = doneClips(db, filmId);
  const cut: CutItem[] = [];
  for (const s of scenes) {
    const mine = clips.filter((c) => c.scene === s.n).reverse();
    const current = mine.find((c) => s.elementIds.every((id) => c.lookVersions[id] === approved[id]));
    const pick = current ?? mine[0];
    if (pick) cut.push({ scene: s.n, jobId: pick.jobId, in: 0, out: pick.seconds });
  }
  if (cut.length === 0) throw new StudioError("No finished clips yet. Render clips and wait for them first.");
  db.prepare("UPDATE films SET cut = ? WHERE id = ?").run(JSON.stringify(cut), filmId);
  return { cut, checks: exportChecks(db, filmId), lengthSec: cutLength(cut) };
}

export function trimCut(db: DB, filmId: string, scene: number, inSec: number, outSec: number): CutItem[] {
  const cut = getCut(db, filmId);
  if (!cut) throw new StudioError("Assemble the cut first");
  const item = cut.find((c) => c.scene === scene);
  if (!item) throw new StudioError(`Scene ${scene} is not in the cut`);
  const clip = doneClips(db, filmId).find((c) => c.jobId === item.jobId);
  const max = clip?.seconds ?? item.out;
  const a = Math.max(0, Math.min(inSec, max));
  const b = Math.max(a, Math.min(outSec, max));
  item.in = Math.round(a * 10) / 10;
  item.out = Math.round(b * 10) / 10;
  db.prepare("UPDATE films SET cut = ? WHERE id = ?").run(JSON.stringify(cut), filmId);
  return cut;
}

export function exportChecks(db: DB, filmId: string): CheckResult[] {
  const film = getFilm(db, filmId);
  const scenes = listScenes(db, filmId);
  return runExportChecks({
    targetSec: film.targetSec,
    sceneNumbers: scenes.map((s) => s.n),
    approvedLooks: approvedLookVersions(db, filmId),
    sceneElements: Object.fromEntries(scenes.map((s) => [s.n, s.elementIds])),
    clips: doneClips(db, filmId),
    cut: getCut(db, filmId) ?? [],
  });
}

/* ------------------------------------------------------------------ money */

export function shotCost(db: DB, filmId: string) {
  const film = getFilm(db, filmId);
  const money = filmMoney(db, filmId, film.budget);
  const approved = approvedLookVersions(db, filmId);
  const scenes = listScenes(db, filmId);
  const clips = doneClips(db, filmId);
  const usable = scenes.filter((s) => clips.some((c) => c.scene === s.n && s.elementIds.every((id) => c.lookVersions[id] === approved[id]))).length;
  const rejected = listLooks(db, filmId)
    .filter((l) => l.status === "rejected")
    .reduce((acc, l) => acc + l.credits, 0);
  return costPerUsableShot(money.spent, usable, rejected);
}

/* ----------------------------------------------------------------- status */

/** Compact state for the model (getStatus) and for recovery prompts. */
export function filmStatus(db: DB, filmId: string) {
  const film = getFilm(db, filmId);
  const looks = latestLooks(db, filmId);
  const jobs = listJobs(db, filmId);
  const lastJob = (kind: JobKind, target: string) => [...jobs].reverse().find((j) => j.kind === kind && j.target === target);
  return {
    film: { title: film.title, targetSec: film.targetSec, aspect: film.aspect, requestedResolution: film.resolution, look: film.look },
    money: filmMoney(db, filmId, film.budget),
    elements: listElements(db, filmId).map((e) => {
      const l = looks.get(e.id);
      return { id: e.id, kind: e.kind, name: e.name, look: l ? { take: l.version, status: l.status, note: l.note } : null };
    }),
    scenes: listScenes(db, filmId).map((s) => ({
      n: s.n,
      heading: s.heading,
      durationSec: s.durationSec,
      elementIds: s.elementIds,
      frame: lastJob("frame", String(s.n))?.status ?? null,
      clip: lastJob("clip", String(s.n))?.status ?? null,
    })),
    activeJobs: jobs.filter((j) => j.status === "queued" || j.status === "running" || j.status === "retrying").map((j) => j.id),
    failingPlanChecks: planChecks(db, filmId).filter((c) => c.status === "fail"),
    openCards: openDecisions(db, filmId).map((d) => ({ id: d.id, kind: d.kind })),
    cut: getCut(db, filmId) ? { lengthSec: cutLength(getCut(db, filmId)!), checks: exportChecks(db, filmId).map((c) => `${c.id}: ${c.status}`) } : null,
  };
}
