import { describe, expect, it } from "vitest";
import { demoDirector, evalDirector } from "../src/agent/directors";
import { loadFixture } from "../src/agent/replay";
import { DEFAULT_BRIEF, EVAL_BRIEFS } from "../src/lib/briefs";
import { filmMoney, listLedger } from "../src/lib/ledger";
import { getRun } from "../src/lib/runs";
import * as studio from "../src/lib/studio";
import { runBrief } from "../src/evals/headless";
import { scoreRun } from "../src/evals/score";

/** The main flow end to end in replay mode: recorded model turns, real tools, real queue, real ledger. No network. */
describe("main flow (replay)", () => {
  it("plans, stops for budget and looks, renders, retries once and assembles a cut", async () => {
    const fixture = loadFixture(DEFAULT_BRIEF.briefId);
    expect(fixture?.briefId).toBe(DEFAULT_BRIEF.briefId);
    const res = await runBrief(DEFAULT_BRIEF, { provider: "replay", fixture, director: demoDirector, latencyScale: 0.01, dbPath: ":memory:", pollMs: 10 });
    const { db, filmId, runId } = res;

    expect(getRun(db, runId)?.status).toBe("done");
    const film = studio.getFilm(db, filmId);
    expect(film.title).toBeTruthy();
    expect(studio.planChecks(db, filmId).every((c) => c.status !== "fail")).toBe(true);

    // Director stops: a budget card first, then two look cards (a redo, then the approval).
    const cards = studio.listDecisions(db, filmId);
    expect(cards.map((c) => c.kind)).toEqual(["budget", "look", "look"]);
    expect(cards.every((c) => c.status === "answered")).toBe(true);

    // The redo produced take 2 for the lead, and frames use it.
    const lead = studio.listElements(db, filmId).find((e) => e.kind === "cast")!;
    expect(studio.latestLooks(db, filmId).get(lead.id)).toMatchObject({ version: 2, status: "approved" });

    // A library match costs nothing.
    expect(studio.listLooks(db, filmId).some((l) => l.status === "reused" && l.credits === 0)).toBe(true);

    // The simulated timeout: one clip failed once, retried on the same key and was charged once.
    const retried = studio.listJobs(db, filmId).filter((j) => j.kind === "clip" && j.attempts === 2);
    expect(retried).toHaveLength(1);
    expect(listLedger(db, filmId).filter((l) => l.jobId === retried[0]!.id && l.kind === "charge")).toHaveLength(1);

    // Within budget, nothing left on hold, every check green, a real cost per usable shot.
    const money = filmMoney(db, filmId, film.budget);
    expect(money.spent).toBeLessThanOrEqual(film.budget);
    expect(money.held).toBe(0);
    expect(studio.exportChecks(db, filmId).every((c) => c.status === "pass")).toBe(true);
    const cost = studio.shotCost(db, filmId);
    expect(cost.usableShots).toBe(studio.listScenes(db, filmId).length);
    expect(cost.rejectedCredits).toBeGreaterThan(0);
    expect(cost.perShot).toBeGreaterThan(0);

    // Trimming one clip by 1 s keeps the export checks green.
    const cut = studio.getCut(db, filmId)!;
    const last = cut[cut.length - 1]!;
    studio.trimCut(db, filmId, last.scene, last.in, last.out - 1);
    expect(studio.exportChecks(db, filmId).every((c) => c.status === "pass")).toBe(true);

    expect(scoreRun(db, filmId, runId, DEFAULT_BRIEF, res.durationMs).trace.every((t) => t.pass)).toBe(true);
  });

  it.each(EVAL_BRIEFS.map((b) => [b.briefId, b] as const))("eval brief %s replays to a passing trace", async (_id, brief) => {
    const fixture = loadFixture(brief.briefId, { preferEval: true });
    expect(fixture?.briefId).toBe(brief.briefId);
    const res = await runBrief(brief, { provider: "replay", fixture, director: evalDirector, latencyScale: 0.005, dbPath: ":memory:", pollMs: 10 });
    const score = scoreRun(res.db, res.filmId, res.runId, brief, res.durationMs);
    expect(score.trace.filter((t) => !t.pass)).toEqual([]);
    if (brief.expectBudgetStop) expect(score.creditsSpent).toBe(0);
  });
});
