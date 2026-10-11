import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentProvider, AgentRunParams, Fixture } from "./provider";

export const FIXTURE_DIR = resolve(/*turbopackIgnore: true*/ process.env.FIXTURE_DIR || "fixtures");
export const DEFAULT_FIXTURE = "tea-flask";

export function fixturePath(briefId: string): string {
  return join(FIXTURE_DIR, `${briefId}.json`);
}

export function evalFixturePath(briefId: string): string {
  return join(FIXTURE_DIR, "evals", `${briefId}.json`);
}

/** The demo recording for a brief, else its eval recording, else the default demo recording. */
export function loadFixture(briefId: string | null | undefined, opts: { preferEval?: boolean } = {}): Fixture | null {
  const own = briefId ? [fixturePath(briefId), evalFixturePath(briefId)] : [];
  const candidates = opts.preferEval ? own.reverse() : own;
  candidates.push(fixturePath(DEFAULT_FIXTURE));
  const p = candidates.find((c) => existsSync(c));
  return p ? (JSON.parse(readFileSync(p, "utf8")) as Fixture) : null;
}

/**
 * Plays a recorded live run. Each recorded model turn is replayed in order and its tool calls go
 * through the same tool layer as a live run, so guards, holds, jobs and the trace all run for real.
 * Director stops wait for the director exactly like a live run; the recorded run decides what comes next.
 */
export class ReplayProvider implements AgentProvider {
  readonly name = "replay" as const;

  constructor(
    private fixture: Fixture,
    private speed = Number(process.env.REPLAY_SPEED ?? 1),
  ) {}

  async run(p: AgentRunParams): Promise<void> {
    const tools = new Map(p.tools.map((t) => [t.name, t]));
    p.hooks.onSession({ sessionId: `replay-${this.fixture.briefId}`, model: `${this.fixture.model} (recorded ${this.fixture.recordedAt.slice(0, 10)})` });
    let i = 0;
    for await (const _input of p.inputs) {
      const seg = this.fixture.segments[i++];
      if (!seg) {
        p.hooks.onTurn({ text: "The recorded run ends here.", toolCalls: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, durationMs: 0 });
        p.hooks.onResult({ durationMs: 0, totalUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: null, turns: 0, isError: false, errors: [] });
        continue;
      }
      const t0 = Date.now();
      for (const turn of seg.turns) {
        await p.waitIfPaused?.();
        await wait(Math.min(turn.durationMs, 1200) * this.speed);
        p.hooks.onTurn(turn);
        for (const call of turn.toolCalls) {
          const t = tools.get(call.name);
          await p.waitIfPaused?.();
          if (t) await t.call(call.input);
        }
      }
      p.hooks.onResult({ ...seg.result, durationMs: Date.now() - t0 });
    }
  }
}

function wait(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}
