import { describe, expect, it } from "vitest";
import { bindTools, TOOL_NAMES } from "../src/agent/tools";
import { listActivity } from "../src/lib/activity";
import { createRun } from "../src/lib/runs";
import * as studio from "../src/lib/studio";
import { RenderQueue } from "../src/worker/queue";
import { ELEMENTS, filmWithPlan, freshDb, SCENES } from "./helpers";

function setup(budget = 150) {
  const db = freshDb();
  const filmId = filmWithPlan(db, { budget });
  const run = createRun(db, filmId, "replay");
  const tools = new Map(bindTools({ db, filmId, runId: run.id, pollMs: 5 }).map((t) => [t.name, t]));
  const call = async (name: string, input: unknown) => {
    const r = await tools.get(name)!.call(input);
    return { ...r, body: JSON.parse(r.text) as Record<string, unknown> };
  };
  return { db, filmId, runId: run.id, call };
}

describe("studio tools", () => {
  it("exposes only the studio tools", () => {
    expect(TOOL_NAMES).toEqual([
      "setProject",
      "upsertElements",
      "writeScenes",
      "searchLibrary",
      "attachLibraryAsset",
      "estimateCost",
      "renderReferences",
      "renderFrames",
      "renderClips",
      "waitForJobs",
      "askDirector",
      "assembleCut",
      "getStatus",
    ]);
    expect(TOOL_NAMES).not.toContain("approveLook");
  });

  it("validates inputs and logs the error without touching state", async () => {
    const { db, filmId, call } = setup();
    const r = await call("writeScenes", { scenes: [{ n: 1, heading: "X" }] });
    expect(r.isError).toBe(true);
    expect(String(r.body.error)).toMatch(/Invalid input/);
    expect(studio.listScenes(db, filmId)).toHaveLength(SCENES.length);
    expect(listActivity(db, filmId).at(-1)).toMatchObject({ kind: "tool", name: "writeScenes", status: "error" });
  });

  it("validates element ids and colours", async () => {
    const { call } = setup();
    expect((await call("upsertElements", { elements: [{ ...ELEMENTS[0], id: "Mara Baker" }] })).isError).toBe(true);
    expect((await call("setProject", { title: "T", logline: "Log line", look: { palette: ["red", "blue"], style: "x1", mood: "y1" } })).isError).toBe(true);
  });

  it("writeScenes returns the plan checks", async () => {
    const { call } = setup();
    const r = await call("writeScenes", { scenes: [{ ...SCENES[0], heading: "a street at night", action: "She feels the rain.", durationSec: 20 }] });
    const checks = r.body.planChecks as { id: string; status: string }[];
    expect(checks.find((c) => c.id === "headings")?.status).toBe("fail");
    expect(checks.find((c) => c.id === "visible-action")?.status).toBe("fail");
  });

  it("a refused render is logged as refused with its quote", async () => {
    const { db, filmId, call } = setup(2);
    const r = await call("renderReferences", { elementIds: ["baker"], model: "sim-image-pro" });
    expect(r.status).toBe("refused");
    expect(r.body).toMatchObject({ status: "refused", reason: "over budget", quoteId: "Q1" });
    expect(listActivity(db, filmId).at(-1)).toMatchObject({ name: "renderReferences", status: "refused" });
  });

  it("returns 'paused' while the director has paused the run", async () => {
    const { db, filmId, runId, call } = setup();
    db.prepare("UPDATE runs SET paused = 1 WHERE id = ?").run(runId);
    const r = await call("renderReferences", { elementIds: ["baker"], model: "sim-image-pro" });
    expect(r.body.status).toBe("paused");
    expect(studio.listJobs(db, filmId)).toHaveLength(0);
  });

  it("waitForJobs blocks until the jobs finish and points at the look card", async () => {
    const { db, call } = setup();
    const q = new RenderQueue(db, { latencyScale: 0.005 });
    q.start(5);
    try {
      const queued = await call("renderReferences", { elementIds: ["baker", "flask"], model: "sim-image-pro" });
      const ids = (queued.body.jobs as { jobId: string }[]).map((j) => j.jobId);
      const r = await call("waitForJobs", { jobIds: ids, timeoutSec: 10 });
      expect((r.body.jobs as { status: string }[]).every((j) => j.status === "done")).toBe(true);
      expect(String(r.body.next)).toMatch(/askDirector/);
      const card = await call("askDirector", { kind: "look", message: "Please review" });
      expect(card.body).toMatchObject({ cardId: expect.stringMatching(/^D\d+$/), status: "open" });
    } finally {
      q.stop();
    }
  });

  it("askDirector refuses a look card when no look is waiting", async () => {
    const { call } = setup();
    const r = await call("askDirector", { kind: "look", message: "Review" });
    expect(r.isError).toBe(true);
  });

  it("attachLibraryAsset costs 0 credits", async () => {
    const { db, filmId, call } = setup();
    const r = await call("attachLibraryAsset", { elementId: "street", assetId: "LIB-01" });
    expect(r.body).toMatchObject({ credits: 0 });
    expect(studio.latestLooks(db, filmId).get("street")?.status).toBe("reused");
  });
});
