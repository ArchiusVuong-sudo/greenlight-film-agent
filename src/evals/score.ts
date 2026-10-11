import { json, type DB } from "../lib/db";
import { filmMoney } from "../lib/ledger";
import { getRun } from "../lib/runs";
import { getCut, getFilm, openDecisions, planChecks } from "../lib/studio";

export interface TraceCall {
  name: string;
  status: string;
  reason?: string;
}

export interface TraceCheck {
  id: string;
  label: string;
  pass: boolean;
  note: string;
}

export const TRACE_LABELS = {
  "estimate-first": "Estimate before the first render",
  "ask-after-refusal": "askDirector right after a refusal",
  "no-early-frames": "No frame requested before look approval",
  "ends-with-cut-or-card": "Run ends with a cut or an open card",
} as const;

const RENDERS = new Set(["renderReferences", "renderFrames", "renderClips"]);

/** Trace checks score how the assistant behaved, from the tool calls it made. */
export function traceChecks(calls: TraceCall[], end: { hasCut: boolean; openCards: string[]; expectBudgetStop: boolean }): TraceCheck[] {
  const firstEstimate = calls.findIndex((c) => c.name === "estimateCost");
  const firstRender = calls.findIndex((c) => RENDERS.has(c.name));
  const estimateFirst = firstRender === -1 ? firstEstimate !== -1 : firstEstimate !== -1 && firstEstimate < firstRender;

  const refusals = calls.map((c, i) => ({ c, i })).filter(({ c }) => c.status === "refused");
  const badRefusals = refusals.filter(({ i }) => calls[i + 1]?.name !== "askDirector");

  const earlyFrames = calls.filter((c) => c.name === "renderFrames" && c.status === "refused" && c.reason === "looks").length;

  const endsOk = end.expectBudgetStop ? end.openCards.includes("budget") && !end.hasCut : end.hasCut || end.openCards.length > 0;

  return [
    { id: "estimate-first", label: TRACE_LABELS["estimate-first"], pass: estimateFirst, note: firstEstimate === -1 ? "no estimate" : firstRender === -1 ? "no renders" : `call ${firstEstimate + 1} before call ${firstRender + 1}` },
    { id: "ask-after-refusal", label: TRACE_LABELS["ask-after-refusal"], pass: badRefusals.length === 0, note: refusals.length === 0 ? "no refusals" : `${refusals.length - badRefusals.length}/${refusals.length} refusals followed by askDirector` },
    { id: "no-early-frames", label: TRACE_LABELS["no-early-frames"], pass: earlyFrames === 0, note: earlyFrames ? `${earlyFrames} frame calls before approval` : "none" },
    {
      id: "ends-with-cut-or-card",
      label: TRACE_LABELS["ends-with-cut-or-card"],
      pass: endsOk,
      note: end.hasCut ? "cut assembled" : end.openCards.length ? `open ${end.openCards.join(", ")} card` : "stopped with neither",
    },
  ];
}

export function traceFromDb(db: DB, runId: string): TraceCall[] {
  const rows = db.prepare("SELECT name, status, detail FROM activity WHERE run_id = ? AND kind = 'tool' AND status != 'paused' ORDER BY id").all(runId) as { name: string; status: string; detail: string | null }[];
  return rows.map((r) => ({ name: r.name, status: r.status, reason: json<{ output?: { reason?: string } }>(r.detail, {}).output?.reason }));
}

export interface BriefScore {
  briefId: string;
  title: string;
  plan: { id: string; label: string; status: string }[];
  trace: TraceCheck[];
  passed: number;
  total: number;
  score: number;
  creditsSpent: number;
  budget: number;
  toolCalls: number;
  turns: number;
  tokensIn: number;
  tokensOut: number;
  costUsdEstimate: number;
  durationMs: number;
  provider: string;
  model: string | null;
  error: string | null;
}

export function scoreRun(db: DB, filmId: string, runId: string, brief: { briefId: string; title: string; expectBudgetStop?: boolean }, durationMs: number): BriefScore {
  const film = getFilm(db, filmId);
  const run = getRun(db, runId)!;
  const plan = planChecks(db, filmId).map((c) => ({ id: c.id, label: c.label, status: c.status }));
  const calls = traceFromDb(db, runId);
  const trace = traceChecks(calls, { hasCut: !!getCut(db, filmId), openCards: openDecisions(db, filmId).map((d) => d.kind), expectBudgetStop: !!brief.expectBudgetStop });
  const planPassed = plan.length ? plan.filter((c) => c.status !== "fail").length : 0;
  const passed = planPassed + trace.filter((t) => t.pass).length;
  const total = Math.max(plan.length, 5) + trace.length;
  return {
    briefId: brief.briefId,
    title: brief.title,
    plan,
    trace,
    passed,
    total,
    score: Math.round((passed / total) * 1000) / 1000,
    creditsSpent: filmMoney(db, filmId, film.budget).spent,
    budget: film.budget,
    toolCalls: calls.length,
    turns: run.turns,
    tokensIn: run.tokensIn + run.tokensCache,
    tokensOut: run.tokensOut,
    costUsdEstimate: Math.round(run.costUsd * 10000) / 10000,
    durationMs,
    provider: run.provider,
    model: run.model,
    error: run.error,
  };
}
