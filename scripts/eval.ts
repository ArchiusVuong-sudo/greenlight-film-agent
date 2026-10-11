/**
 * Scores six synthetic briefs on the plan checks and four trace checks.
 * npm run eval               live assistant, writes evals/report.json and fixtures/evals/*.json
 * DEMO_REPLAY=1 npm run eval replays the recorded eval runs (no login needed), writes evals/report.replay.json
 * Optional: --only=brief-id,brief-id  --parallel=2
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { detectMode } from "../src/agent/detect";
import { evalDirector } from "../src/agent/directors";
import { evalFixturePath, loadFixture } from "../src/agent/replay";
import { EVAL_BRIEFS, type Brief } from "../src/lib/briefs";
import { runBrief } from "../src/evals/headless";
import { buildReport } from "../src/evals/report";
import { scoreRun, type BriefScore } from "../src/evals/score";

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}

async function evalOne(brief: Brief, mode: "live" | "replay"): Promise<BriefScore> {
  const fixture = mode === "replay" ? loadFixtureStrict(brief.briefId) : null;
  const res = await runBrief(brief, {
    provider: mode,
    fixture,
    director: evalDirector,
    recordTo: mode === "live" ? evalFixturePath(brief.briefId) : undefined,
    model: process.env.AGENT_MODEL || undefined,
    latencyScale: mode === "live" ? 0.3 : 0.01,
  });
  const s = scoreRun(res.db, res.filmId, res.runId, brief, res.durationMs);
  console.log(`${brief.briefId.padEnd(14)} ${s.passed}/${s.total}  ${s.creditsSpent}/${s.budget} cr  ${Math.round(s.durationMs / 1000)} s  ${s.trace.filter((t) => !t.pass).map((t) => t.id).join(", ")}`);
  res.dispose();
  return s;
}

function loadFixtureStrict(briefId: string) {
  const f = loadFixture(briefId, { preferEval: true });
  if (!f || f.briefId !== briefId) throw new Error(`No recorded eval run for ${briefId}. Run npm run eval with a login first.`);
  return f;
}

async function main() {
  const mode = detectMode().mode;
  const only = arg("only")?.split(",");
  const parallel = Math.max(1, Number(arg("parallel") ?? 2));
  const briefs = EVAL_BRIEFS.filter((b) => !only || only.includes(b.briefId));
  console.log(`Running ${briefs.length} briefs (${mode}, ${parallel} at a time)`);
  const results: BriefScore[] = new Array(briefs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: parallel }, async () => {
      while (next < briefs.length) {
        const i = next++;
        results[i] = await evalOne(briefs[i]!, mode);
      }
    }),
  );
  const model = results.find((r) => r.model)?.model ?? (process.env.AGENT_MODEL || "default");
  const report = buildReport(results, mode, model);
  mkdirSync("evals", { recursive: true });
  const out = mode === "live" && !only ? "evals/report.json" : mode === "live" ? "evals/report.partial.json" : "evals/report.replay.json";
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Mean score ${Math.round(report.meanScore * 100)}%, written to ${out}`);
}

void main();
