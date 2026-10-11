import { describe, expect, it } from "vitest";
import { allocate, priceLine, priceRequest } from "../src/lib/catalog";

describe("pricing", () => {
  it("prices images per image plus reference inputs", () => {
    expect(priceLine({ kind: "frame", target: "1", model: "sim-image-pro", refInputs: 3 }).exact).toBe(5.5);
    expect(priceLine({ kind: "reference", target: "a", model: "sim-image-fast", refInputs: 0 }).exact).toBe(1);
  });

  it("prices clips per second at the chosen resolution", () => {
    expect(priceLine({ kind: "clip", target: "1", model: "sim-video-pro", resolution: "1080p", seconds: 5, refInputs: 1 }).exact).toBe(35.5);
    expect(priceLine({ kind: "clip", target: "1", model: "sim-video-pro", resolution: "720p", seconds: 5, refInputs: 1 }).exact).toBe(20.5);
  });

  it("rejects a resolution the model cannot render and the wrong model kind", () => {
    expect(() => priceLine({ kind: "clip", target: "1", model: "sim-video-lite", resolution: "1080p", seconds: 4, refInputs: 0 })).toThrow(/does not render 1080p/);
    expect(() => priceLine({ kind: "clip", target: "1", model: "sim-image-pro", seconds: 4, refInputs: 0 })).toThrow(/not a video model/);
    expect(() => priceLine({ kind: "frame", target: "1", model: "sim-video-pro", refInputs: 0 })).toThrow(/not an image model/);
  });

  it("rounds the request total up once, not per line", () => {
    const lines = [1, 2, 3].map((n) => ({ kind: "frame" as const, target: String(n), model: "sim-image-fast", refInputs: 1 }));
    // 3 x 1.5 = 4.5 -> 5 (per-line rounding would give 6)
    expect(priceRequest(lines).total).toBe(5);
    expect(priceRequest([]).total).toBe(0);
  });

  it("allocates whole-credit holds that add up to the rounded total", () => {
    const exact = [1.5, 1.5, 1.5];
    const holds = allocate(exact, 5);
    expect(holds.reduce((a, b) => a + b, 0)).toBe(5);
    expect(holds.every((h) => h === 1 || h === 2)).toBe(true);
    expect(allocate([4, 4], 8)).toEqual([4, 4]);
    expect(allocate([0.25, 0.25, 0.25, 0.25], 1).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("puts the default plan over 150 at 1080p and inside it at 720p", () => {
    const plan = (res: "720p" | "1080p") =>
      priceRequest([
        ...["a", "b", "c"].map((t) => ({ kind: "reference" as const, target: t, model: "sim-image-pro", refInputs: 0 })),
        ...[1, 2, 3, 4].map((n) => ({ kind: "frame" as const, target: String(n), model: "sim-image-pro", refInputs: 3 })),
        ...[5, 5, 5, 5].map((s, i) => ({ kind: "clip" as const, target: String(i + 1), model: "sim-video-pro", resolution: res, seconds: s, refInputs: 1 })),
      ]).total;
    expect(plan("1080p")).toBeGreaterThan(150);
    expect(plan("720p")).toBeLessThanOrEqual(150);
  });
});
