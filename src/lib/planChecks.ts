import type { CheckResult, CheckStatus, DialogueLine, ElementRow } from "./types";

export interface PlanScene {
  n: number;
  heading: string;
  action: string;
  dialogue: DialogueLine[];
  durationSec: number;
  elementIds: string[];
}

/** Screenwriting rules the plan has to follow. Ids are stable so a fail that turns into a pass shows as fixed. */
export const PLAN_RULES = [
  { id: "length", label: "Total length within 10% of the target" },
  { id: "headings", label: "Headings read INT./EXT. PLACE - TIME" },
  { id: "visible-action", label: "Action shows only what the camera sees" },
  { id: "dialogue-fit", label: "Dialogue fits the shot (max 2.5 words/s)" },
  { id: "references", label: "Every speaker and linked element exists" },
] as const;

export const MAX_WORDS_PER_SEC = 2.5;

const HEADING = /^(INT\.|EXT\.|INT\.\/EXT\.|EXT\.\/INT\.|I\/E\.)\s+(\S.*?)\s+[-–—]\s+([A-Z][A-Z' ]*[A-Z])$/;

/** Inner-state verbs a camera cannot film. */
const INNER_VERBS = [
  "feel", "feels", "felt", "feeling",
  "think", "thinks", "thinking",
  "wonder", "wonders", "wondered", "wondering",
  "realize", "realizes", "realized", "realise", "realises", "realised",
  "remember", "remembers", "remembered",
  "know", "knows", "knew",
  "believe", "believes", "believed",
  "wish", "wishes", "wished",
  "hope", "hopes", "hoped",
  "want", "wants", "wanted",
  "imagine", "imagines", "imagined",
  "worry", "worries", "worried",
];

export function checkHeading(heading: string): boolean {
  return HEADING.test(heading.trim());
}

export function innerStateWords(action: string): string[] {
  const words = action.toLowerCase().match(/[a-z']+/g) ?? [];
  return [...new Set(words.filter((w) => INNER_VERBS.includes(w)))];
}

export function wordCount(text: string): number {
  return (text.match(/[A-Za-z0-9À-ɏ']+/g) ?? []).length;
}

export function dialogueRate(scene: PlanScene): number {
  const words = scene.dialogue.reduce((acc, d) => acc + wordCount(d.line), 0);
  return scene.durationSec > 0 ? words / scene.durationSec : Infinity;
}

export function runPlanChecks(
  targetSec: number,
  scenes: PlanScene[],
  elements: ElementRow[],
  previous: CheckResult[] = [],
): CheckResult[] {
  const problems: Record<string, string[]> = { length: [], headings: [], "visible-action": [], "dialogue-fit": [], references: [] };

  if (scenes.length === 0) {
    problems.length!.push("No scenes yet");
  } else {
    const total = scenes.reduce((acc, s) => acc + s.durationSec, 0);
    const delta = Math.abs(total - targetSec);
    if (delta > targetSec * 0.1 + 1e-9) {
      problems.length!.push(`Scenes add up to ${round1(total)} s, target is ${targetSec} s (allowed ${round1(targetSec * 0.9)}-${round1(targetSec * 1.1)} s)`);
    }
  }

  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const s of scenes) {
    if (!checkHeading(s.heading)) problems.headings!.push(`Scene ${s.n}: "${s.heading}" should look like EXT. STONE BRIDGE - DAWN`);
    const inner = innerStateWords(s.action);
    if (inner.length) problems["visible-action"]!.push(`Scene ${s.n}: "${inner.join('", "')}" is not visible on screen`);
    const rate = dialogueRate(s);
    if (s.dialogue.length && rate > MAX_WORDS_PER_SEC + 1e-9) {
      problems["dialogue-fit"]!.push(`Scene ${s.n}: ${round1(rate)} words/s in ${s.durationSec} s (max ${MAX_WORDS_PER_SEC})`);
    }
    for (const d of s.dialogue) {
      const el = byId.get(d.speaker);
      if (!el) problems.references!.push(`Scene ${s.n}: speaker "${d.speaker}" is not a cast element`);
      else if (el.kind !== "cast") problems.references!.push(`Scene ${s.n}: speaker "${d.speaker}" is a ${el.kind}, not cast`);
    }
    for (const id of s.elementIds) {
      if (!byId.has(id)) problems.references!.push(`Scene ${s.n}: linked element "${id}" does not exist`);
    }
  }

  const prev = new Map(previous.map((c) => [c.id, c.status]));
  return PLAN_RULES.map((rule) => {
    const list = problems[rule.id] ?? [];
    const failed = list.length > 0;
    const was = prev.get(rule.id);
    const status: CheckStatus = failed ? "fail" : was === "fail" || was === "fixed" ? "fixed" : "pass";
    return { id: rule.id, label: rule.label, status, problems: list };
  });
}

export function allPass(checks: CheckResult[]): boolean {
  return checks.length > 0 && checks.every((c) => c.status !== "fail");
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
