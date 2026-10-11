import { z } from "zod";
import { logActivity } from "../lib/activity";
import type { DB } from "../lib/db";
import * as studio from "../lib/studio";
import { CAMERA_MOVES, ELEMENT_KINDS, IMAGE_MODELS, RESOLUTIONS, VIDEO_MODELS, elementSchema, lookSchema, sceneSchema } from "../lib/types";

export interface ToolContext {
  db: DB;
  filmId: string;
  runId: string | null;
  /** Polling interval for waitForJobs (tests shorten it). */
  pollMs?: number;
}

export type ToolStatus = "ok" | "refused" | "error" | "paused";

export interface ToolOutput {
  status: ToolStatus;
  /** Credits held by this call (render tools). */
  credits?: number;
  data: Record<string, unknown>;
  summary: string;
}

interface ToolSpec<S extends z.ZodRawShape> {
  name: string;
  description: string;
  shape: S;
  run: (args: z.output<z.ZodObject<S>>, ctx: ToolContext) => Promise<ToolOutput> | ToolOutput;
}

function defineTool<S extends z.ZodRawShape>(spec: ToolSpec<S>): ToolSpec<S> {
  return spec;
}

const ok = (summary: string, data: Record<string, unknown>, credits?: number): ToolOutput => ({ status: "ok", summary, data, credits });

const imageModel = z.enum(IMAGE_MODELS).describe("sim-image-pro for looks and frames, sim-image-fast for cheap drafts");
const videoModel = z.enum(VIDEO_MODELS);

function renderResult(out: studio.RenderOutcome, what: string): ToolOutput {
  if (out.status === "queued") {
    const n = out.jobs.length;
    return {
      status: "ok",
      credits: out.total,
      summary: `Queued ${n} ${what}${n === 1 ? "" : "s"} (${out.total} cr held)${out.reused.length ? `, ${out.reused.length} already exist` : ""}`,
      data: { status: "queued", jobs: out.jobs, alreadyExisting: out.reused, heldCredits: out.total, money: out.money, next: "Call waitForJobs with these job ids." },
    };
  }
  if (out.reason === "budget") {
    return {
      status: "refused",
      summary: `Refused: ${out.total} cr is over the ${out.money.remaining} cr left. Quote ${out.quoteId}`,
      data: { status: "refused", reason: "over budget", quoteId: out.quoteId, quoteTotal: out.total, money: out.money, message: out.message },
    };
  }
  return { status: "refused", summary: out.message, data: { status: "refused", reason: out.reason, message: out.message, missing: out.missing } };
}

export const TOOL_SPECS = [
  defineTool({
    name: "setProject",
    description: "Set the film title, a one-line logline and the look (2-5 palette colours as #rrggbb, a style line and a mood line).",
    shape: { title: z.string().min(1).max(80), logline: z.string().min(3).max(240), look: lookSchema },
    run: (a, ctx) => {
      studio.setProject(ctx.db, ctx.filmId, a);
      return ok(`Title "${a.title}", palette ${a.look.palette.join(" ")}`, { saved: true });
    },
  }),
  defineTool({
    name: "upsertElements",
    description:
      "Create or update cast, location and prop elements. Ids are short lowercase slugs you choose (for example 'baker', 'stone-bridge', 'flask'). Put visible details such as colours in the description. Returns the plan checks.",
    shape: { elements: z.array(elementSchema).min(1).max(12) },
    run: (a, ctx) => {
      const checks = studio.upsertElements(ctx.db, ctx.filmId, a.elements);
      return ok(`Saved ${a.elements.length} elements: ${a.elements.map((e) => e.id).join(", ")}`, { saved: a.elements.map((e) => e.id), planChecks: checks });
    },
  }),
  defineTool({
    name: "writeScenes",
    description:
      "Write the full scene list (it replaces the previous one). Each scene: n, heading as 'EXT. PLACE - TIME' or 'INT. PLACE - TIME', action with only what the camera sees, dialogue lines whose speaker is a cast element id (vo: true for voice-over), durationSec, the element ids that appear, and a camera move. Returns the plan checks; fix any that fail.",
    shape: { scenes: z.array(sceneSchema).min(1).max(8) },
    run: (a, ctx) => {
      const checks = studio.writeScenes(ctx.db, ctx.filmId, a.scenes);
      const total = a.scenes.reduce((acc, s) => acc + s.durationSec, 0);
      const failing = checks.filter((c) => c.status === "fail");
      return ok(`Wrote ${a.scenes.length} scenes, ${total} s. Checks: ${failing.length ? `${failing.length} failing` : "all pass"}`, { totalSec: total, planChecks: checks });
    },
  }),
  defineTool({
    name: "searchLibrary",
    description: "Search the library of previously approved references. Attaching one costs 0 credits.",
    shape: { query: z.string().min(2).max(120), kind: z.enum(ELEMENT_KINDS).optional() },
    run: (a) => {
      const hits = studio.searchLibrary(a.query, a.kind);
      return ok(`${hits.length} matches for "${a.query}"`, { matches: hits });
    },
  }),
  defineTool({
    name: "attachLibraryAsset",
    description: "Use an approved library reference as the look for an element. Costs 0 credits and counts as approved.",
    shape: { elementId: z.string().min(1), assetId: z.string().min(1) },
    run: (a, ctx) => {
      const look = studio.attachLibraryAsset(ctx.db, ctx.filmId, a.elementId, a.assetId);
      return ok(`${a.elementId} reuses ${a.assetId} (0 cr)`, { elementId: a.elementId, look: { take: look.version, status: look.status }, credits: 0 }, 0);
    },
  }),
  defineTool({
    name: "estimateCost",
    description:
      "Price renders against the director's budget without spending. List the element ids that need a reference, the scene numbers that need a frame and the scene numbers that need a clip. Returns line items, the total (rounded up once) and whether it fits.",
    shape: {
      references: z.array(z.string()).default([]),
      frames: z.array(z.number().int()).default([]),
      clips: z.array(z.number().int()).default([]),
      imageModel,
      videoModel,
      resolution: z.enum(RESOLUTIONS),
    },
    run: (a, ctx) => {
      const reqs: studio.RenderRequest[] = [];
      if (a.references.length) reqs.push({ kind: "reference", elementIds: a.references, model: a.imageModel });
      if (a.frames.length) reqs.push({ kind: "frame", scenes: a.frames, model: a.imageModel });
      if (a.clips.length) reqs.push({ kind: "clip", scenes: a.clips, model: a.videoModel, resolution: a.resolution });
      if (!reqs.length) throw new studio.StudioError("List at least one reference, frame or clip to price");
      const est = studio.estimate(ctx.db, ctx.filmId, reqs);
      return ok(`Estimate ${est.total} cr at ${a.resolution}; ${est.money.remaining} cr left; ${est.fits ? "fits" : "over budget"}`, { ...est });
    },
  }),
  defineTool({
    name: "renderReferences",
    description:
      "Render one reference image (a look) per element. Inside the budget the jobs are queued with holds; outside it you get a refusal with a quote. Elements whose look is approved or reused are skipped. A redo renders the next take with the director's note.",
    shape: { elementIds: z.array(z.string()).min(1).max(10), model: imageModel },
    run: (a, ctx) => renderResult(studio.requestRenders(ctx.db, ctx.filmId, { kind: "reference", elementIds: a.elementIds, model: a.model }, { runId: ctx.runId }), "reference"),
  }),
  defineTool({
    name: "renderFrames",
    description: "Render the first frame of each scene from the approved looks. Refused while any linked element lacks an approved or reused look.",
    shape: { scenes: z.array(z.number().int()).min(1).max(8), model: imageModel },
    run: (a, ctx) => renderResult(studio.requestRenders(ctx.db, ctx.filmId, { kind: "frame", scenes: a.scenes, model: a.model }, { runId: ctx.runId }), "frame"),
  }),
  defineTool({
    name: "renderClips",
    description: "Render a clip per scene from its finished frame, with the scene's camera move and length.",
    shape: { scenes: z.array(z.number().int()).min(1).max(8), model: videoModel, resolution: z.enum(RESOLUTIONS) },
    run: (a, ctx) => renderResult(studio.requestRenders(ctx.db, ctx.filmId, { kind: "clip", scenes: a.scenes, model: a.model, resolution: a.resolution }, { runId: ctx.runId }), "clip"),
  }),
  defineTool({
    name: "waitForJobs",
    description: "Wait until the given render jobs finish (or all active jobs when no ids are given). Returns each job's status, attempts and errors.",
    shape: { jobIds: z.array(z.string()).default([]), timeoutSec: z.number().min(5).max(180).default(120) },
    run: async (a, ctx) => {
      const t0 = Date.now();
      const poll = ctx.pollMs ?? 300;
      const pick = () => {
        const all = studio.listJobs(ctx.db, ctx.filmId);
        return a.jobIds.length ? all.filter((j) => a.jobIds.includes(j.id)) : all.filter((j) => j.status !== "done" && j.status !== "failed" && j.createdAt >= t0 - 3600_000);
      };
      let jobs = pick();
      const unknown = a.jobIds.filter((id) => !jobs.some((j) => j.id === id));
      if (unknown.length) throw new studio.StudioError(`Unknown job ids: ${unknown.join(", ")}`);
      const ids = jobs.map((j) => j.id);
      while (Date.now() - t0 < a.timeoutSec * 1000) {
        jobs = studio.listJobs(ctx.db, ctx.filmId).filter((j) => ids.includes(j.id));
        if (jobs.every((j) => j.status === "done" || j.status === "failed")) break;
        await new Promise((r) => setTimeout(r, poll));
      }
      const done = jobs.filter((j) => j.status === "done").length;
      const failed = jobs.filter((j) => j.status === "failed").length;
      const pendingLooks = jobs.some((j) => j.kind === "reference" && j.status === "done");
      return ok(`${done} done, ${failed} failed, ${jobs.length - done - failed} still running`, {
        jobs: jobs.map((j) => ({ jobId: j.id, kind: j.kind, target: j.target, status: j.status, attempts: j.attempts, errors: j.errors.map((e) => `attempt ${e.attempt}: ${e.message}`), credits: j.price })),
        next: pendingLooks ? "New looks are waiting for the director. Call askDirector with kind 'look'." : undefined,
      });
    },
  }),
  defineTool({
    name: "askDirector",
    description:
      "Stop and ask the director. kind 'look' opens a look card for the elements whose looks are waiting (only the director can approve looks). kind 'budget' opens a budget card: pass quoteId after a refusal, and options with an estimateCredits each. kind 'question' asks a question with options. After calling it, end your turn; the answer arrives as the next message.",
    shape: {
      kind: z.enum(["look", "budget", "question"]),
      message: z.string().min(3).max(400),
      elementIds: z.array(z.string()).optional(),
      quoteId: z.string().optional(),
      options: z
        .array(z.object({ id: z.string().regex(/^[a-z0-9-]{1,40}$/), label: z.string().min(1).max(120), detail: z.string().max(240).optional(), estimateCredits: z.number().optional() }))
        .max(4)
        .optional(),
    },
    run: (a, ctx) => {
      const d = studio.openDecision(ctx.db, ctx.filmId, ctx.runId, { kind: a.kind, message: a.message, elementIds: a.elementIds, options: a.options, quoteId: a.quoteId });
      return ok(`Opened ${a.kind} card ${d.id}`, { cardId: d.id, kind: d.kind, status: "open", next: "End your turn now. The director's answer arrives as the next message." });
    },
  }),
  defineTool({
    name: "assembleCut",
    description: "Put the finished clips in scene order on the timeline and run the export checks.",
    shape: {},
    run: (_a, ctx) => {
      const res = studio.assembleCut(ctx.db, ctx.filmId);
      const failing = res.checks.filter((c) => c.status === "fail");
      return ok(`Cut of ${res.cut.length} clips, ${Math.round(res.lengthSec * 10) / 10} s. Export checks: ${failing.length ? `${failing.length} failing` : "all pass"}`, { ...res });
    },
  }),
  defineTool({
    name: "getStatus",
    description: "Read the current state: budget, elements and looks, scene frames and clips, active jobs, open cards and the cut.",
    shape: {},
    run: (_a, ctx) => ok("Read status", studio.filmStatus(ctx.db, ctx.filmId)),
  }),
];

export const TOOL_NAMES = TOOL_SPECS.map((t) => t.name);
export const RENDER_TOOLS = new Set(["renderReferences", "renderFrames", "renderClips"]);
export { CAMERA_MOVES };

export interface ToolCallResult {
  text: string;
  isError: boolean;
  status: ToolStatus;
}

export interface BoundTool {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  call: (raw: unknown) => Promise<ToolCallResult>;
}

/**
 * Wraps every tool the same way for the live and the replay provider:
 * pause check, input validation, timing, error handling and one Activity row per call.
 */
export function bindTools(ctx: ToolContext): BoundTool[] {
  return TOOL_SPECS.map((spec) => ({
    name: spec.name,
    description: spec.description,
    shape: spec.shape,
    call: async (raw: unknown): Promise<ToolCallResult> => {
      const t0 = Date.now();
      const log = (status: ToolStatus, summary: string, detail: unknown, credits?: number) =>
        logActivity(ctx.db, {
          filmId: ctx.filmId,
          runId: ctx.runId,
          kind: "tool",
          name: spec.name,
          status: status === "ok" ? "ok" : status,
          summary,
          durationMs: Date.now() - t0,
          credits: credits ?? null,
          detail,
        });
      if (ctx.runId && isPaused(ctx.db, ctx.runId)) {
        const text = JSON.stringify({ status: "paused", message: "The director paused the run. End your turn now without calling more tools." });
        log("paused", "Paused by the director", { input: raw });
        return { text, isError: false, status: "paused" };
      }
      const parsed = z.object(spec.shape).safeParse(raw ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
        log("error", `Invalid input: ${issues}`, { input: raw });
        return { text: JSON.stringify({ status: "error", error: `Invalid input: ${issues}` }), isError: true, status: "error" };
      }
      try {
        const out = await (spec.run as (a: unknown, c: ToolContext) => Promise<ToolOutput> | ToolOutput)(parsed.data, ctx);
        log(out.status, out.summary, { input: parsed.data, output: out.data }, out.credits);
        return { text: JSON.stringify({ status: out.status, ...out.data }), isError: false, status: out.status };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log("error", message, { input: parsed.data });
        return { text: JSON.stringify({ status: "error", error: message }), isError: true, status: "error" };
      }
    },
  }));
}

export function isPaused(db: DB, runId: string): boolean {
  const r = db.prepare("SELECT paused FROM runs WHERE id = ?").get(runId) as { paused: number } | undefined;
  return r?.paused === 1;
}
