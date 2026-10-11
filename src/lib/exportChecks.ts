import type { CheckResult, CutItem } from "./types";

export interface ExportClip {
  jobId: string;
  scene: number;
  seconds: number;
  /** Look versions the clip was built from, per element id. */
  lookVersions: Record<string, number>;
}

export interface ExportInput {
  targetSec: number;
  sceneNumbers: number[];
  /** Current approved (or reused) look version per element id. */
  approvedLooks: Record<string, number>;
  sceneElements: Record<number, string[]>;
  clips: ExportClip[];
  cut: CutItem[];
}

export const EXPORT_RULES = [
  { id: "coverage", label: "Every scene is covered" },
  { id: "gaps", label: "No gaps or empty clips" },
  { id: "length", label: "Total within 1 s of the target" },
  { id: "looks", label: "Every clip uses the current approved looks" },
] as const;

export const MIN_CLIP_SEC = 0.5;

export function cutLength(cut: CutItem[]): number {
  return cut.reduce((acc, c) => acc + Math.max(0, c.out - c.in), 0);
}

export function runExportChecks(input: ExportInput): CheckResult[] {
  const problems: Record<string, string[]> = { coverage: [], gaps: [], length: [], looks: [] };
  const covered = new Set(input.cut.map((c) => c.scene));
  for (const n of input.sceneNumbers) if (!covered.has(n)) problems.coverage!.push(`Scene ${n} has no clip in the cut`);
  if (input.cut.length === 0) problems.coverage!.push("The cut is empty");

  const clips = new Map(input.clips.map((c) => [c.jobId, c]));
  let lastScene = 0;
  for (const item of input.cut) {
    const len = item.out - item.in;
    if (len < MIN_CLIP_SEC) problems.gaps!.push(`Scene ${item.scene}: clip is ${round1(Math.max(len, 0))} s long (min ${MIN_CLIP_SEC} s)`);
    if (item.scene < lastScene) problems.gaps!.push(`Scene ${item.scene} is out of order`);
    lastScene = item.scene;
    const clip = clips.get(item.jobId);
    if (!clip) {
      problems.looks!.push(`Scene ${item.scene}: clip ${item.jobId} is missing`);
      continue;
    }
    if (item.in < 0 || item.out > clip.seconds + 1e-9) problems.gaps!.push(`Scene ${item.scene}: trim goes past the clip (0-${clip.seconds} s)`);
    for (const el of input.sceneElements[item.scene] ?? []) {
      const want = input.approvedLooks[el];
      const got = clip.lookVersions[el];
      if (want === undefined) problems.looks!.push(`Scene ${item.scene}: ${el} has no approved look`);
      else if (got !== want) problems.looks!.push(`Scene ${item.scene}: built from ${el} take ${got ?? "none"}, approved is take ${want}`);
    }
  }
  // Scenes between the first and last cut item must all be there.
  const nums = [...covered].sort((a, b) => a - b);
  for (const n of input.sceneNumbers) {
    if (nums.length && n > nums[0]! && n < nums[nums.length - 1]! && !covered.has(n)) problems.gaps!.push(`Gap at scene ${n}`);
  }

  const total = cutLength(input.cut);
  if (Math.abs(total - input.targetSec) > 1 + 1e-9) problems.length!.push(`Cut is ${round1(total)} s, target is ${input.targetSec} s`);

  return EXPORT_RULES.map((r) => ({ id: r.id, label: r.label, status: problems[r.id]!.length ? "fail" : "pass", problems: problems[r.id]! }));
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
