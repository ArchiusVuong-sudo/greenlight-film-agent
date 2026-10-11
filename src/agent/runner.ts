import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { logActivity } from "../lib/activity";
import { json, type DB } from "../lib/db";
import { getRun, takeInput, updateRun } from "../lib/runs";
import { answerDecision, getCut, getFilm, getQuote, latestLooks, listScenes, openDecision, openDecisions } from "../lib/studio";
import type { Decision, DecisionAnswer } from "../lib/types";
import { briefMessage, recoveryMessage, SYSTEM_PROMPT } from "./prompt";
import { AuthError, RetryableError, ZERO_USAGE, type AgentProvider, type Fixture, type SegmentResult, type TurnRecord } from "./provider";
import { backoffMs } from "./retry";
import { bindTools } from "./tools";

/** Answers cards without a human (evals and fixture recording). null leaves the card open and ends the run. */
export type AutoDirector = (db: DB, filmId: string, d: Decision) => DecisionAnswer | null;

export interface RunOptions {
  provider: AgentProvider;
  model?: string;
  maxTurns?: number;
  /** Write the run as a replay fixture to this path. */
  recordTo?: string | null;
  director?: AutoDirector;
  pollMs?: number;
  /** A run with no director input for this long ends. */
  idleTimeoutMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Called when a live run cannot sign in, before any tool ran; may return a replacement provider. */
  onAuthError?: (err: Error) => AgentProvider | null;
}

class Signal {
  private resolve: (() => void) | null = null;
  private fired = false;
  fire() {
    this.fired = true;
    this.resolve?.();
  }
  async wait() {
    if (!this.fired) await new Promise<void>((r) => (this.resolve = r));
    this.fired = false;
    this.resolve = null;
  }
}

const sleepDefault = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Runs the assistant for one film. Each director stop ends a model turn; the run then waits for the
 * director (or the auto-director) and sends the answer into the same live session.
 */
export async function executeRun(db: DB, runId: string, opts: RunOptions): Promise<void> {
  const run = getRun(db, runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  const filmId = run.filmId;
  const pollMs = opts.pollMs ?? 300;
  const sleep = opts.sleep ?? sleepDefault;
  const idleTimeout = opts.idleTimeoutMs ?? 30 * 60_000;
  const maxRetries = opts.maxRetries ?? 4;
  let provider = opts.provider;
  const recorder: Fixture | null = opts.recordTo
    ? { briefId: getFilm(db, filmId).briefId ?? "custom", recordedAt: new Date().toISOString(), model: opts.model ?? "default", segments: [] }
    : null;

  updateRun(db, runId, { status: "running", provider: provider.name, model: opts.model ?? null });
  const tools = bindTools({ db, filmId, runId, pollMs });
  const film = getFilm(db, filmId);
  const startedFresh = listScenes(db, filmId).length === 0 && !takePeek(db, runId);
  let first = startedFresh ? briefMessage(film) : recoveryMessage(db, film, drainInputs(db, runId));
  let toolCallsSeen = 0;
  let baseUsage = { ...ZERO_USAGE };
  let baseCost = 0;
  let lastUsage = { ...ZERO_USAGE };
  let lastCost = 0;
  let finalStatus: "done" | "stopped" | "error" = "stopped";
  let nudges = 0;

  logActivity(db, { filmId, runId, kind: "system", name: "run", status: "info", summary: `Run started (${provider.name}${opts.model ? `, ${opts.model}` : ""})` });

  for (let attempt = 1; ; attempt++) {
    const segEnd = new Signal();
    let ended = false;
    const inputs = async function* (): AsyncGenerator<string> {
      recorder?.segments.push({ input: first, turns: [], result: emptyResult() });
      yield first;
      while (true) {
        await segEnd.wait();
        const next = await nextInput();
        if (next === null) {
          ended = true;
          return;
        }
        recorder?.segments.push({ input: next, turns: [], result: emptyResult() });
        yield next;
      }
    };

    const nextInput = async (): Promise<string | null> => {
      let idleSince = Date.now();
      while (true) {
        const r = getRun(db, runId);
        if (!r || r.status === "stopped") return null;
        const input = takeInput(db, runId);
        if (input) {
          updateRun(db, runId, { status: "running" });
          return input.text;
        }
        const open = openDecisions(db, filmId);
        const cut = getCut(db, filmId);
        if (!open.length && cut) {
          finalStatus = "done";
          return null;
        }
        if (opts.director) {
          if (!open.length) {
            // The model stopped without a card or a cut: nudge it once, then give up.
            if (nudges++ >= 1) {
              finalStatus = "stopped";
              return null;
            }
            logActivity(db, { filmId, runId, kind: "director", name: "auto-director", status: "info", summary: "Continue." });
            return "Continue from the current state.";
          } else {
            const d = open[0]!;
            const answer = opts.director(db, filmId, d);
            if (!answer) {
              finalStatus = "stopped";
              return null;
            }
            const message = answerDecision(db, filmId, d.id, answer);
            logActivity(db, { filmId, runId, kind: "director", name: "auto-director", status: "info", summary: message });
            return message;
          }
        }
        updateRun(db, runId, { status: open.length ? "waiting" : "idle" });
        if (Date.now() - idleSince > idleTimeout) return null;
        await sleep(pollMs);
        if (takePeek(db, runId)) idleSince = Date.now();
      }
    };

    try {
      await provider.run({
        system: SYSTEM_PROMPT,
        inputs: inputs(),
        tools,
        model: opts.model,
        maxTurns: opts.maxTurns ?? 80,
        waitIfPaused: async () => {
          while (true) {
            const r = getRun(db, runId);
            if (!r || !r.paused || r.status === "stopped") return;
            await sleep(pollMs);
          }
        },
        hooks: {
          onSession: ({ sessionId, model }) => updateRun(db, runId, { session_id: sessionId, model }),
          onTurn: (t: TurnRecord) => {
            toolCallsSeen += t.toolCalls.length;
            recorder?.segments.at(-1)?.turns.push(t);
            const names = t.toolCalls.map((c) => c.name);
            logActivity(db, {
              filmId,
              runId,
              kind: "turn",
              name: "model turn",
              status: "ok",
              durationMs: t.durationMs,
              tokensIn: t.usage.input + t.usage.cacheRead + t.usage.cacheWrite,
              tokensOut: t.usage.output,
              summary: t.text.trim() || (names.length ? `Calls ${names.join(", ")}` : "(no text)"),
              detail: { text: t.text, toolCalls: names },
            });
            db.prepare("UPDATE runs SET turns = turns + 1 WHERE id = ?").run(runId);
          },
          onResult: (res: SegmentResult) => {
            const seg = recorder?.segments.at(-1);
            if (seg) seg.result = res;
            lastUsage = res.totalUsage;
            lastCost = res.costUsd ?? 0;
            updateRun(db, runId, {
              tokens_in: baseUsage.input + res.totalUsage.input,
              tokens_out: baseUsage.output + res.totalUsage.output,
              tokens_cache: baseUsage.cacheRead + baseUsage.cacheWrite + res.totalUsage.cacheRead + res.totalUsage.cacheWrite,
              cost_usd: baseCost + (res.costUsd ?? 0),
            });
            if (res.isError) logActivity(db, { filmId, runId, kind: "system", name: "result", status: "error", summary: res.errors.join("; ") || "The model run ended with an error" });
            serverFallbackCard(db, filmId, runId);
            if (recorder && opts.recordTo) saveFixture(opts.recordTo, recorder);
            segEnd.fire();
          },
        },
      });
      if (!ended && finalStatus !== "done") finalStatus = getCut(db, filmId) ? "done" : "stopped";
      break;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      baseUsage = addUsage(baseUsage, lastUsage);
      baseCost += lastCost;
      lastUsage = { ...ZERO_USAGE };
      lastCost = 0;
      if (err instanceof AuthError && toolCallsSeen === 0 && opts.onAuthError) {
        const next = opts.onAuthError(err);
        if (next) {
          logActivity(db, { filmId, runId, kind: "system", name: "provider", status: "error", summary: `${err.message}. Switched to ${next.name} mode` });
          provider = next;
          updateRun(db, runId, { provider: next.name });
          continue;
        }
      }
      if (err instanceof RetryableError && attempt < maxRetries) {
        const delay = backoffMs(attempt);
        logActivity(db, { filmId, runId, kind: "system", name: "retry", status: "error", summary: `${err.message}. Retrying in ${Math.round(delay / 1000)} s with a fresh session and the current state (attempt ${attempt + 1} of ${maxRetries})` });
        await sleep(delay);
        first = recoveryMessage(db, getFilm(db, filmId), drainInputs(db, runId));
        continue;
      }
      finalStatus = "error";
      updateRun(db, runId, { error: err.message.slice(0, 500) });
      logActivity(db, { filmId, runId, kind: "system", name: "run", status: "error", summary: err.message });
      break;
    }
  }

  if (recorder && opts.recordTo) saveFixture(opts.recordTo, recorder);
  const current = getRun(db, runId);
  const status = current?.status === "stopped" ? "stopped" : finalStatus;
  updateRun(db, runId, { status, ended_at: Date.now() });
  logActivity(db, { filmId, runId, kind: "system", name: "run", status: status === "error" ? "error" : "info", summary: status === "done" ? "Run finished with a cut" : status === "error" ? "Run ended with an error" : "Run ended" });
}

function takePeek(db: DB, runId: string): boolean {
  return !!db.prepare("SELECT 1 FROM run_inputs WHERE run_id = ? AND consumed_at IS NULL").get(runId);
}

function drainInputs(db: DB, runId: string): string[] {
  const out: string[] = [];
  for (let i = takeInput(db, runId); i; i = takeInput(db, runId)) out.push(i.text);
  return out;
}

function emptyResult(): SegmentResult {
  return { durationMs: 0, totalUsage: { ...ZERO_USAGE }, costUsd: null, turns: 0, isError: false, errors: [] };
}

function addUsage(a: typeof ZERO_USAGE, b: typeof ZERO_USAGE) {
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite };
}

export function saveFixture(path: string, f: Fixture): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(f, null, 1)}\n`);
}

/**
 * If the model ended its turn right after a refusal without asking the director,
 * the server opens the card itself so the run never stalls silently.
 */
export function serverFallbackCard(db: DB, filmId: string, runId: string): Decision | null {
  if (openDecisions(db, filmId).length) return null;
  const last = db.prepare("SELECT name, status, detail FROM activity WHERE run_id = ? AND kind = 'tool' ORDER BY id DESC LIMIT 1").get(runId) as
    | { name: string; status: string; detail: string | null }
    | undefined;
  if (!last || last.status !== "refused") return null;
  const out = json<{ output?: { quoteId?: string; reason?: string; quoteTotal?: number; money?: { remaining: number } } }>(last.detail, {}).output ?? {};
  try {
    let d: Decision | null = null;
    if (out.quoteId && getQuote(db, filmId, out.quoteId)?.status === "open") {
      d = openDecision(
        db,
        filmId,
        runId,
        {
          kind: "budget",
          message: `This render needs ${out.quoteTotal} cr and ${out.money?.remaining ?? 0} cr of the budget is left.`,
          quoteId: out.quoteId,
          options: [{ id: "replan", label: "Ask the assistant for a cheaper plan" }],
        },
        "server",
      );
    } else if ([...latestLooks(db, filmId).values()].some((l) => l.status === "pending")) {
      d = openDecision(db, filmId, runId, { kind: "look", message: "These looks need your approval before frames can render." }, "server");
    }
    if (d) logActivity(db, { filmId, runId, kind: "system", name: "server card", status: "info", summary: `Server opened ${d.kind} card ${d.id} after a refusal` });
    return d;
  } catch {
    return null;
  }
}
