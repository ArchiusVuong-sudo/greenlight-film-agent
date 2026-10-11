import { describe, expect, it } from "vitest";
import { evalDirector } from "../src/agent/directors";
import { AuthError, RetryableError, type AgentProvider, type AgentRunParams, type Fixture } from "../src/agent/provider";
import { ReplayProvider } from "../src/agent/replay";
import { executeRun } from "../src/agent/runner";
import { listActivity } from "../src/lib/activity";
import { createRun, getRun } from "../src/lib/runs";
import * as studio from "../src/lib/studio";
import { filmWithPlan, freshDb } from "./helpers";

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 };
const result = { durationMs: 1, totalUsage: usage, costUsd: 0.001, turns: 1, isError: false, errors: [] };
const fixture = (turns: Fixture["segments"][number]["turns"][]): Fixture => ({
  briefId: "test",
  recordedAt: "2026-10-11T00:00:00Z",
  model: "test",
  segments: turns.map((t) => ({ input: "x", turns: t, result })),
});
const turn = (name: string, input: unknown) => ({ text: "", toolCalls: [{ name, input }], usage, durationMs: 0 });
const noSleep = async () => undefined;

describe("runner", () => {
  it("opens a budget card itself when the model ends its turn right after a refusal", async () => {
    const db = freshDb();
    const filmId = filmWithPlan(db, { budget: 2 });
    const run = createRun(db, filmId, "replay");
    await executeRun(db, run.id, {
      provider: new ReplayProvider(fixture([[turn("renderReferences", { elementIds: ["baker"], model: "sim-image-pro" })]]), 0),
      director: () => null,
      pollMs: 5,
    });
    const open = studio.openDecisions(db, filmId);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ kind: "budget", openedBy: "server" });
    expect(open[0]!.payload.options?.[0]?.id).toBe("approve-quote");
    expect(getRun(db, run.id)?.status).toBe("stopped");
  });

  it("sends director answers into the same session and finishes on a cut", async () => {
    const db = freshDb();
    const filmId = filmWithPlan(db);
    studio.attachLibraryAsset(db, filmId, "street", "LIB-01");
    studio.attachLibraryAsset(db, filmId, "bridge", "LIB-03");
    const { RenderQueue } = await import("../src/worker/queue");
    const q = new RenderQueue(db, { latencyScale: 0.003 });
    q.start(5);
    const seen: string[] = [];
    const provider: AgentProvider = {
      name: "replay",
      async run(p: AgentRunParams) {
        const tools = new Map(p.tools.map((t) => [t.name, t]));
        let i = 0;
        for await (const input of p.inputs) {
          seen.push(input);
          if (i === 0) {
            const r = JSON.parse((await tools.get("renderReferences")!.call({ elementIds: ["baker", "flask"], model: "sim-image-pro" })).text);
            await tools.get("waitForJobs")!.call({ jobIds: r.jobs.map((j: { jobId: string }) => j.jobId), timeoutSec: 10 });
            await tools.get("askDirector")!.call({ kind: "look", message: "Review" });
          } else {
            await tools.get("renderFrames")!.call({ scenes: [1, 2, 3], model: "sim-image-fast" });
            await tools.get("waitForJobs")!.call({ timeoutSec: 10 });
            await tools.get("renderClips")!.call({ scenes: [1, 2, 3], model: "sim-video-lite", resolution: "720p" });
            await tools.get("waitForJobs")!.call({ timeoutSec: 10 });
            await tools.get("assembleCut")!.call({});
          }
          i++;
          p.hooks.onResult(result);
        }
      },
    };
    const run = createRun(db, filmId, "replay");
    try {
      await executeRun(db, run.id, { provider, director: evalDirector, pollMs: 5 });
    } finally {
      q.stop();
    }
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatch(/Director answered look card D\d+/);
    expect(getRun(db, run.id)?.status).toBe("done");
    expect(studio.exportChecks(db, filmId).every((c) => c.status === "pass")).toBe(true);
  });

  it("retries a rate-limited session with backoff and a state summary", async () => {
    const db = freshDb();
    const filmId = filmWithPlan(db);
    let calls = 0;
    const firstInputs: string[] = [];
    const provider: AgentProvider = {
      name: "live",
      async run(p) {
        calls++;
        for await (const input of p.inputs) {
          firstInputs.push(input);
          if (calls === 1) throw new RetryableError("Model error: rate_limit");
          await p.tools.find((t) => t.name === "assembleCut")!.call({});
          p.hooks.onResult(result);
          break;
        }
      },
    };
    const run = createRun(db, filmId, "live");
    await executeRun(db, run.id, { provider, director: () => null, pollMs: 5, sleep: noSleep });
    expect(calls).toBe(2);
    expect(firstInputs[1]).toMatch(/continuing work on a film/);
    expect(listActivity(db, filmId).some((a) => a.name === "retry" && /rate_limit/.test(a.summary))).toBe(true);
  });

  it("gives up after the retry limit and records the error", async () => {
    const db = freshDb();
    const filmId = filmWithPlan(db);
    const provider: AgentProvider = {
      name: "live",
      async run() {
        throw new RetryableError("overloaded");
      },
    };
    const run = createRun(db, filmId, "live");
    await executeRun(db, run.id, { provider, pollMs: 5, sleep: noSleep, maxRetries: 3 });
    expect(getRun(db, run.id)).toMatchObject({ status: "error", error: "overloaded" });
  });

  it("switches to replay when the login fails before any tool ran", async () => {
    const db = freshDb();
    const filmId = filmWithPlan(db);
    const live: AgentProvider = {
      name: "live",
      async run() {
        throw new AuthError("authentication_failed");
      },
    };
    const replay = new ReplayProvider(fixture([[turn("getStatus", {})]]), 0);
    const run = createRun(db, filmId, "live");
    await executeRun(db, run.id, { provider: live, onAuthError: () => replay, director: () => null, pollMs: 5 });
    expect(getRun(db, run.id)?.provider).toBe("replay");
    expect(listActivity(db, filmId).some((a) => a.kind === "tool" && a.name === "getStatus")).toBe(true);
  });

  it("replay waits at a turn boundary while paused and goes on when the pause is lifted", async () => {
    const db = freshDb();
    const filmId = filmWithPlan(db);
    const run = createRun(db, filmId, "replay");
    db.prepare("UPDATE runs SET paused = 1 WHERE id = ?").run(run.id);
    const done = executeRun(db, run.id, { provider: new ReplayProvider(fixture([[turn("getStatus", {})]]), 0), director: () => null, pollMs: 5 });
    await new Promise((r) => setTimeout(r, 60));
    expect(listActivity(db, filmId).some((a) => a.kind === "tool")).toBe(false);
    db.prepare("UPDATE runs SET paused = 0 WHERE id = ?").run(run.id);
    await done;
    expect(listActivity(db, filmId).filter((a) => a.kind === "tool").map((a) => a.status)).toEqual(["ok"]);
  });
});
