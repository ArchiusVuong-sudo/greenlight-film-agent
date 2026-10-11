/**
 * Records the demo run for replay mode: the sample brief through the live assistant,
 * with an auto-director that answers the cards the way the demo does.
 * Usage: npm run record            (writes fixtures/tea-flask.json)
 */
import { demoDirector } from "../src/agent/directors";
import { fixturePath } from "../src/agent/replay";
import { listActivity } from "../src/lib/activity";
import { DEFAULT_BRIEF } from "../src/lib/briefs";
import { getCut, listDecisions } from "../src/lib/studio";
import { runBrief } from "../src/evals/headless";
import { getRun } from "../src/lib/runs";

async function main() {
  const out = fixturePath(DEFAULT_BRIEF.briefId);
  const res = await runBrief(DEFAULT_BRIEF, { provider: "live", director: demoDirector, recordTo: out, model: process.env.AGENT_MODEL || undefined });
  for (const a of listActivity(res.db, res.filmId, 1000)) {
    if (a.kind === "job" && a.status === "info") continue;
    console.log(`${a.kind.padEnd(8)} ${a.status.padEnd(7)} ${a.name.padEnd(18)} ${a.summary.slice(0, 140).replace(/\n/g, " ")}`);
  }
  const run = getRun(res.db, res.runId)!;
  console.log(`\nrun ${run.status} in ${Math.round(res.durationMs / 1000)} s, ${run.turns} turns, cards: ${listDecisions(res.db, res.filmId).map((d) => `${d.id}:${d.kind}:${d.status}`).join(" ")}, cut: ${getCut(res.db, res.filmId) ? "yes" : "no"}`);
  console.log(`fixture written to ${out}`);
  res.dispose();
  if (run.status !== "done") process.exitCode = 1;
}

void main();
