import type { BriefScore } from "./score";

export interface EvalReport {
  ranAt: string;
  provider: "live" | "replay";
  model: string;
  meanScore: number;
  results: BriefScore[];
}

export function buildReport(results: BriefScore[], provider: "live" | "replay", model: string): EvalReport {
  const mean = results.length ? results.reduce((a, r) => a + r.score, 0) / results.length : 0;
  return { ranAt: new Date().toISOString(), provider, model, meanScore: Math.round(mean * 1000) / 1000, results };
}
