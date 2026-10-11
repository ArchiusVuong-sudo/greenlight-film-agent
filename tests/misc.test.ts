import { describe, expect, it } from "vitest";
import { childEnv, detectMode } from "../src/agent/detect";
import { backoffMs, isAuthError, isRetryable, withRetry } from "../src/agent/retry";
import { locationType, renderFrame, renderReference, timeOfDay } from "../src/lib/render/svg";
import { traceChecks, type TraceCall } from "../src/evals/score";

describe("retry", () => {
  it("classifies retryable and auth errors", () => {
    for (const m of ["Model error: overloaded", "rate_limit", "HTTP 529", "502 Bad Gateway", "server_error"]) expect(isRetryable(m)).toBe(true);
    expect(isRetryable("invalid_request: bad schema")).toBe(false);
    expect(isAuthError("authentication_failed")).toBe(true);
  });

  it("backs off exponentially with jitter and a cap", () => {
    expect(backoffMs(1, () => 0)).toBe(1000);
    expect(backoffMs(1, () => 1)).toBe(2000);
    expect(backoffMs(3, () => 1)).toBe(8000);
    expect(backoffMs(10, () => 1)).toBe(30000);
  });

  it("withRetry retries only retryable errors", async () => {
    let n = 0;
    const waits: number[] = [];
    const v = await withRetry(
      async () => {
        if (++n < 3) throw new Error("overloaded");
        return "ok";
      },
      { sleep: async (ms) => void waits.push(ms), random: () => 0 },
    );
    expect(v).toBe("ok");
    expect(waits).toEqual([1000, 2000]);
    await expect(withRetry(async () => Promise.reject(new Error("invalid_request")), { sleep: async () => undefined })).rejects.toThrow("invalid_request");
  });
});

describe("mode and child env", () => {
  it("DEMO_REPLAY=1 forces replay and an API key means live", () => {
    expect(detectMode({ DEMO_REPLAY: "1", ANTHROPIC_API_KEY: "x" }).mode).toBe("replay");
    expect(detectMode({ ANTHROPIC_API_KEY: "x" }).mode).toBe("live");
  });

  it("passes only allowlisted variables to the model process", () => {
    const env = childEnv({ PATH: "/bin", HOME: "/h", CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", SECRET_TOKEN: "s", ANTHROPIC_API_KEY: "k" });
    expect(env).toEqual({ PATH: "/bin", HOME: "/h", ANTHROPIC_API_KEY: "k" });
  });
});

describe("trace checks", () => {
  const end = { hasCut: true, openCards: [] as string[], expectBudgetStop: false };
  const ids = (calls: TraceCall[], e = end) => Object.fromEntries(traceChecks(calls, e).map((t) => [t.id, t.pass]));

  it("passes a well-behaved trace", () => {
    const calls: TraceCall[] = [
      { name: "estimateCost", status: "ok" },
      { name: "renderReferences", status: "refused", reason: "budget" },
      { name: "askDirector", status: "ok" },
      { name: "renderFrames", status: "ok" },
    ];
    expect(ids(calls)).toEqual({ "estimate-first": true, "ask-after-refusal": true, "no-early-frames": true, "ends-with-cut-or-card": true });
  });

  it("catches a render before any estimate, a refusal not followed by askDirector and early frames", () => {
    const calls: TraceCall[] = [
      { name: "renderFrames", status: "refused", reason: "looks" },
      { name: "estimateCost", status: "ok" },
    ];
    expect(ids(calls, { hasCut: false, openCards: [], expectBudgetStop: false })).toEqual({
      "estimate-first": false,
      "ask-after-refusal": false,
      "no-early-frames": false,
      "ends-with-cut-or-card": false,
    });
  });

  it("an impossible budget must end on an open budget card", () => {
    const calls: TraceCall[] = [{ name: "estimateCost", status: "ok" }, { name: "askDirector", status: "ok" }];
    expect(ids(calls, { hasCut: false, openCards: ["budget"], expectBudgetStop: true })["ends-with-cut-or-card"]).toBe(true);
    expect(ids(calls, { hasCut: false, openCards: ["look"], expectBudgetStop: true })["ends-with-cut-or-card"]).toBe(false);
  });
});

describe("procedural renders", () => {
  it("picks the location from the element name before the description", () => {
    expect(locationType({ name: "Rainy city street", description: "shop windows glow" })).toBe("street");
    expect(locationType({ name: "Kitchen", description: "a table" })).toBe("interior");
    expect(locationType({ name: "Old place", description: "a stone bridge over a river" })).toBe("bridge");
  });

  it("reads the time of day from the heading", () => {
    expect(timeOfDay("EXT. BRIDGE - SUNRISE")).toBe("dawn");
    expect(timeOfDay("EXT. STREET - NIGHT")).toBe("night");
    expect(timeOfDay("INT. KITCHEN - DAY")).toBe("day");
  });

  it("stamps every render and sizes frames by aspect ratio", () => {
    const ref = renderReference({ id: "a", kind: "prop", name: "Flask", description: "steel flask", color: null, version: 1 }, ["#111111", "#222222"]);
    expect(ref).toContain("SIMULATED RENDER");
    const frame = renderFrame({ aspect: "9:16", palette: ["#111111", "#222222"], heading: "EXT. STREET - NIGHT", sceneN: 1, elements: [] });
    expect(frame).toContain('viewBox="0 0 540 960"');
    expect(frame).toContain("SIMULATED RENDER");
  });

  it("is deterministic for the same input", () => {
    const input = { aspect: "16:9" as const, palette: ["#111111", "#222222"], heading: "EXT. STREET - NIGHT", sceneN: 2, elements: [] };
    expect(renderFrame(input)).toBe(renderFrame(input));
  });
});
