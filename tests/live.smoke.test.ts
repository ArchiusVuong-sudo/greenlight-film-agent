import { describe, expect, it } from "vitest";
import { evalDirector } from "../src/agent/directors";
import { EVAL_BRIEFS } from "../src/lib/briefs";
import { runBrief } from "../src/evals/headless";
import { scoreRun } from "../src/evals/score";

/** Opt-in: LIVE=1 npm run test:live. One real run on the local Claude Code login (or ANTHROPIC_API_KEY). */
describe.runIf(process.env.LIVE === "1")("live smoke", () => {
  it("the live assistant stops on a budget card for an impossible budget", async () => {
    const brief = EVAL_BRIEFS.find((b) => b.briefId === "tiny-chase")!;
    const res = await runBrief(brief, { provider: "live", director: evalDirector, model: process.env.AGENT_MODEL || undefined, dbPath: ":memory:" });
    const score = scoreRun(res.db, res.filmId, res.runId, brief, res.durationMs);
    expect(score.error).toBeNull();
    expect(score.creditsSpent).toBe(0);
    expect(score.trace.find((t) => t.id === "ends-with-cut-or-card")?.pass).toBe(true);
    expect(score.tokensOut).toBeGreaterThan(0);
  }, 300_000);
});
