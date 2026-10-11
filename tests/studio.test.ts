import { describe, expect, it, vi } from "vitest";
import { filmMoney, listLedger } from "../src/lib/ledger";
import * as studio from "../src/lib/studio";
import { RenderQueue } from "../src/worker/queue";
import { filmWithPlan, freshDb } from "./helpers";

const money = (db: ReturnType<typeof freshDb>, id: string) => filmMoney(db, id, studio.getFilm(db, id).budget);

describe("spend gate", () => {
  it("queues a render inside the budget and places one hold per job", () => {
    const db = freshDb();
    const id = filmWithPlan(db);
    const out = studio.requestRenders(db, id, { kind: "reference", elementIds: ["baker", "flask"], model: "sim-image-pro" });
    expect(out.status).toBe("queued");
    if (out.status !== "queued") return;
    expect(out.jobs.map((j) => j.holdCredits)).toEqual([4, 4]);
    expect(money(db, id)).toMatchObject({ held: 8, spent: 0, remaining: 142 });
    expect(listLedger(db, id).filter((l) => l.kind === "hold")).toHaveLength(2);
  });

  it("reusing an idempotency key returns the existing job and adds no hold", () => {
    const db = freshDb();
    const id = filmWithPlan(db);
    studio.requestRenders(db, id, { kind: "reference", elementIds: ["baker"], model: "sim-image-pro" });
    const again = studio.requestRenders(db, id, { kind: "reference", elementIds: ["baker"], model: "sim-image-pro" });
    expect(again.status).toBe("queued");
    if (again.status !== "queued") return;
    expect(again.jobs).toHaveLength(0);
    expect(again.reused[0]?.idemKey).toBe("ref:baker:v1");
    expect(money(db, id).held).toBe(4);
    expect(studio.listJobs(db, id)).toHaveLength(1);
  });

  it("outside the budget it refuses, queues nothing and makes a single-use quote", () => {
    const db = freshDb();
    const id = filmWithPlan(db, { budget: 5 });
    const out = studio.requestRenders(db, id, { kind: "reference", elementIds: ["baker", "flask"], model: "sim-image-pro" });
    expect(out.status).toBe("refused");
    if (out.status !== "refused" || out.reason !== "budget") throw new Error("expected a budget refusal");
    expect(out.total).toBe(8);
    expect(studio.listJobs(db, id)).toHaveLength(0);
    expect(money(db, id).held).toBe(0);

    const approved = studio.approveQuote(db, id, out.quoteId, null);
    expect(approved.jobs).toHaveLength(2);
    expect(money(db, id).held).toBe(8);
    expect(() => studio.approveQuote(db, id, out.quoteId, null)).toThrow(/already used/);
  });

  it("an expired quote cannot be approved", () => {
    const db = freshDb();
    const id = filmWithPlan(db, { budget: 1 });
    const out = studio.requestRenders(db, id, { kind: "reference", elementIds: ["baker"], model: "sim-image-pro" });
    if (out.status !== "refused" || out.reason !== "budget") throw new Error("expected a refusal");
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + studio.QUOTE_TTL_MS + 1000);
    try {
      expect(() => studio.approveQuote(db, id, out.quoteId, null)).toThrow(/expired/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses frames until every linked element has an approved or reused look", () => {
    const db = freshDb();
    const id = filmWithPlan(db);
    const out = studio.requestRenders(db, id, { kind: "frame", scenes: [1], model: "sim-image-pro" });
    expect(out).toMatchObject({ status: "refused", reason: "looks" });
  });

  it("refuses clips until the scene has a finished frame", () => {
    const db = freshDb();
    const id = filmWithPlan(db);
    expect(studio.requestRenders(db, id, { kind: "clip", scenes: [1], model: "sim-video-pro", resolution: "720p" })).toMatchObject({ status: "refused", reason: "order" });
  });

  it("estimates the whole plan without writing anything", () => {
    const db = freshDb();
    const id = filmWithPlan(db);
    const est = studio.estimate(db, id, [
      { kind: "reference", elementIds: ["baker", "flask", "street", "bridge"], model: "sim-image-pro" },
      { kind: "frame", scenes: [1, 2, 3], model: "sim-image-pro" },
      { kind: "clip", scenes: [1, 2, 3], model: "sim-video-pro", resolution: "1080p" },
    ]);
    expect(est.total).toBe(Math.ceil(16 + 5.5 + 5.5 + 5 + 140 + 1.5));
    expect(est.fits).toBe(false);
    expect(studio.listJobs(db, id)).toHaveLength(0);
  });
});

describe("library and looks", () => {
  it("reuses a library reference for 0 credits as an approved look", () => {
    const db = freshDb();
    const id = filmWithPlan(db);
    expect(studio.searchLibrary("rainy city street", "location")[0]?.assetId).toBe("LIB-01");
    const look = studio.attachLibraryAsset(db, id, "street", "LIB-01");
    expect(look).toMatchObject({ status: "reused", credits: 0, source: "library" });
    expect(money(db, id).committed).toBe(0);
    expect(() => studio.attachLibraryAsset(db, id, "baker", "LIB-01")).toThrow(/is a location/);
  });

  it("only the director approves looks, and a redo renders the next take with the note", async () => {
    const db = freshDb();
    const id = filmWithPlan(db);
    const q = new RenderQueue(db, { latencyScale: 0.005 });
    studio.requestRenders(db, id, { kind: "reference", elementIds: ["baker", "flask"], model: "sim-image-pro" });
    await q.drain();
    const card = studio.openDecision(db, id, null, { kind: "look", message: "Looks ready" });
    expect(card.payload.elementIds).toEqual(["baker", "flask"]);
    const msg = studio.answerDecision(db, id, card.id, {
      kind: "look",
      looks: [
        { elementId: "baker", verdict: "redo", note: "yellow raincoat, not red" },
        { elementId: "flask", verdict: "approve" },
      ],
    });
    expect(msg).toMatch(/Redo: baker \(take 1\)/);
    expect(studio.latestLooks(db, id).get("baker")?.status).toBe("rejected");
    const redo = studio.requestRenders(db, id, { kind: "reference", elementIds: ["baker"], model: "sim-image-pro" });
    if (redo.status !== "queued") throw new Error("expected queued");
    expect(redo.jobs[0]?.idemKey).toBe("ref:baker:v2");
    expect(studio.getJob(db, id, redo.jobs[0]!.jobId)?.params.note).toBe("yellow raincoat, not red");
    expect(() => studio.answerDecision(db, id, card.id, { kind: "look", looks: [{ elementId: "baker", verdict: "approve" }] })).toThrow(/already answered/);
  });

  it("a look card needs a verdict for every look on it", async () => {
    const db = freshDb();
    const id = filmWithPlan(db);
    const q = new RenderQueue(db, { latencyScale: 0.005 });
    studio.requestRenders(db, id, { kind: "reference", elementIds: ["baker", "flask"], model: "sim-image-pro" });
    await q.drain();
    const card = studio.openDecision(db, id, null, { kind: "look", message: "Looks" });
    expect(() => studio.answerDecision(db, id, card.id, { kind: "look", looks: [{ elementId: "baker", verdict: "approve" }] })).toThrow(/Missing a verdict for flask/);
  });

  it("a budget card with a quote offers an approve option that queues exactly the quote", () => {
    const db = freshDb();
    const id = filmWithPlan(db, { budget: 3 });
    const out = studio.requestRenders(db, id, { kind: "reference", elementIds: ["baker"], model: "sim-image-pro" });
    if (out.status !== "refused" || out.reason !== "budget") throw new Error("expected a refusal");
    const card = studio.openDecision(db, id, null, { kind: "budget", message: "Over", quoteId: out.quoteId, options: [{ id: "fast", label: "Use sim-image-fast", estimateCredits: 1 }] });
    expect(card.payload.options?.map((o) => o.id)).toEqual(["approve-quote", "fast"]);
    const msg = studio.answerDecision(db, id, card.id, { kind: "option", optionId: "approve-quote" });
    expect(msg).toMatch(/Queued exactly the quoted renders: J\d+/);
    expect(studio.listJobs(db, id)).toHaveLength(1);
  });
});

describe("cost per usable shot", () => {
  it("says there are no usable shots instead of 0", () => {
    const db = freshDb();
    const id = filmWithPlan(db);
    expect(studio.shotCost(db, id).perShot).toBeNull();
  });
});
