import { describe, expect, it } from "vitest";
import { filmMoney, listLedger } from "../src/lib/ledger";
import * as studio from "../src/lib/studio";
import { RenderQueue, SIMULATED_TIMEOUT, sleep } from "../src/worker/queue";
import { filmWithPlan, freshDb } from "./helpers";

function approveAll(db: ReturnType<typeof freshDb>, id: string) {
  for (const lib of [["street", "LIB-01"], ["bridge", "LIB-03"]] as const) studio.attachLibraryAsset(db, id, lib[0], lib[1]);
  const card = studio.openDecision(db, id, null, { kind: "look", message: "Looks" });
  studio.answerDecision(db, id, card.id, { kind: "look", looks: (card.payload.elementIds ?? []).map((e) => ({ elementId: e, verdict: "approve" as const })) });
}

describe("render queue", () => {
  it("runs at most two jobs at a time", async () => {
    const db = freshDb();
    const id = filmWithPlan(db);
    const q = new RenderQueue(db, { latencyScale: 0.03 });
    studio.requestRenders(db, id, { kind: "reference", elementIds: ["baker", "flask", "street", "bridge"], model: "sim-image-fast" });
    let peak = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 5000) {
      q.tick();
      const running = (db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status = 'running'").get() as { n: number }).n;
      peak = Math.max(peak, running);
      if (studio.listJobs(db, id).every((j) => j.status === "done")) break;
      await sleep(5);
    }
    expect(peak).toBe(2);
    expect(studio.listJobs(db, id).every((j) => j.status === "done")).toBe(true);
  });

  it("charges each finished job once and turns looks into pending approvals", async () => {
    const db = freshDb();
    const id = filmWithPlan(db);
    const q = new RenderQueue(db, { latencyScale: 0.005 });
    studio.requestRenders(db, id, { kind: "reference", elementIds: ["baker", "flask"], model: "sim-image-pro" });
    await q.drain();
    const m = filmMoney(db, id, 150);
    expect(m).toMatchObject({ spent: 8, held: 0 });
    expect(studio.latestLooks(db, id).get("baker")?.status).toBe("pending");
    expect(studio.latestLooks(db, id).get("baker")?.assetId).toBeTruthy();
  });

  it("a simulated provider timeout retries on the same key and is charged once", async () => {
    const db = freshDb();
    const id = filmWithPlan(db, { simulateTimeout: true, budget: 400 });
    const q = new RenderQueue(db, { latencyScale: 0.005 });
    studio.requestRenders(db, id, { kind: "reference", elementIds: ["baker", "flask"], model: "sim-image-pro" });
    await q.drain();
    approveAll(db, id);
    studio.requestRenders(db, id, { kind: "frame", scenes: [1, 2, 3], model: "sim-image-pro" });
    await q.drain();
    const out = studio.requestRenders(db, id, { kind: "clip", scenes: [1, 2, 3], model: "sim-video-pro", resolution: "720p" });
    if (out.status !== "queued") throw new Error("expected queued");
    await q.drain();
    const first = studio.getJob(db, id, out.jobs[0]!.jobId)!;
    expect(first.status).toBe("done");
    expect(first.attempts).toBe(2);
    expect(first.errors[0]?.message).toBe(SIMULATED_TIMEOUT);
    const entries = listLedger(db, id).filter((l) => l.jobId === first.id);
    expect(entries.map((e) => e.kind)).toEqual(["hold", "charge"]);
    expect(studio.listJobs(db, id).filter((j) => j.kind === "clip" && j.attempts > 1)).toHaveLength(1);
    expect(filmMoney(db, id, 400).held).toBe(0);
  });

  it("releases the hold when a job finally fails", async () => {
    const db = freshDb();
    const id = filmWithPlan(db);
    const q = new RenderQueue(db, { latencyScale: 0.002 });
    studio.requestRenders(db, id, { kind: "reference", elementIds: ["baker"], model: "sim-image-pro" });
    db.prepare("DELETE FROM elements WHERE film_id = ? AND id = 'baker'").run(id); // the renderer can no longer draw it
    await q.drain();
    const job = studio.listJobs(db, id)[0]!;
    expect(job.status).toBe("failed");
    expect(job.attempts).toBe(3);
    expect(listLedger(db, id).filter((l) => l.jobId === job.id).map((l) => l.kind)).toEqual(["hold", "release"]);
    expect(filmMoney(db, id, 150)).toMatchObject({ spent: 0, held: 0 });
  });

  it("frames use the approved look colour, so a redo to yellow renders yellow", async () => {
    const db = freshDb();
    const id = filmWithPlan(db);
    const q = new RenderQueue(db, { latencyScale: 0.002 });
    studio.requestRenders(db, id, { kind: "reference", elementIds: ["baker", "flask"], model: "sim-image-pro" });
    await q.drain();
    const card = studio.openDecision(db, id, null, { kind: "look", message: "Looks" });
    studio.answerDecision(db, id, card.id, { kind: "look", looks: [{ elementId: "baker", verdict: "redo", note: "yellow raincoat, not red" }, { elementId: "flask", verdict: "approve" }] });
    studio.requestRenders(db, id, { kind: "reference", elementIds: ["baker"], model: "sim-image-pro" });
    await q.drain();
    approveAll(db, id);
    const out = studio.requestRenders(db, id, { kind: "frame", scenes: [1], model: "sim-image-pro" });
    if (out.status !== "queued") throw new Error("expected queued");
    await q.drain();
    const svg = (db.prepare("SELECT svg FROM assets WHERE id = ?").get(studio.getJob(db, id, out.jobs[0]!.jobId)!.assetId) as { svg: string }).svg;
    expect(svg).toContain("#f2cf3b"); // yellow
    expect(svg).not.toContain("#d6453d"); // red
    expect(svg).toContain("SIMULATED RENDER");
  });
});
