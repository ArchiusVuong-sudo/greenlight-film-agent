import { describe, expect, it } from "vitest";
import { extractColors, primaryColor, COLOR_WORDS } from "../src/lib/colors";
import { runExportChecks, type ExportInput } from "../src/lib/exportChecks";
import { checkHeading, dialogueRate, innerStateWords, runPlanChecks, type PlanScene } from "../src/lib/planChecks";
import type { ElementRow } from "../src/lib/types";

const els: ElementRow[] = [
  { id: "mara", kind: "cast", name: "Mara", description: "Baker" },
  { id: "flask", kind: "prop", name: "Flask", description: "Steel" },
];
const scene = (over: Partial<PlanScene> = {}): PlanScene => ({ n: 1, heading: "EXT. BRIDGE - DAWN", action: "Mara pours tea.", dialogue: [], durationSec: 10, elementIds: ["mara"], ...over });
const status = (checks: ReturnType<typeof runPlanChecks>, id: string) => checks.find((c) => c.id === id)!.status;

describe("plan checks", () => {
  it("accepts INT./EXT. PLACE - TIME with a hyphen, en dash or em dash", () => {
    expect(checkHeading("EXT. STONE BRIDGE - DAWN")).toBe(true);
    expect(checkHeading("INT. BAKERY – NIGHT")).toBe(true);
    expect(checkHeading("INT./EXT. CAR — MOVING")).toBe(true);
    expect(checkHeading("Stone bridge at dawn")).toBe(false);
    expect(checkHeading("EXT. BRIDGE DAWN")).toBe(false);
    expect(checkHeading("EXT. - DAWN")).toBe(false);
  });

  it("flags inner-state verbs in action", () => {
    expect(innerStateWords("She feels tired and thinks of home.")).toEqual(["feels", "thinks"]);
    expect(innerStateWords("She pours tea. Steam rises.")).toEqual([]);
  });

  it("measures dialogue words per second", () => {
    expect(dialogueRate(scene({ dialogue: [{ speaker: "mara", line: "one two three four five" }], durationSec: 2 }))).toBe(2.5);
  });

  it("checks total length within 10% of the target", () => {
    expect(status(runPlanChecks(20, [scene({ durationSec: 22 })], els), "length")).toBe("pass");
    expect(status(runPlanChecks(20, [scene({ durationSec: 22.5 })], els), "length")).toBe("fail");
    expect(status(runPlanChecks(20, [], els), "length")).toBe("fail");
  });

  it("fails dialogue over 2.5 words per second", () => {
    const fast = scene({ durationSec: 2, dialogue: [{ speaker: "mara", line: "one two three four five six" }] });
    expect(status(runPlanChecks(2, [fast], els), "dialogue-fit")).toBe("fail");
  });

  it("checks that speakers are cast and linked elements exist", () => {
    const checks = runPlanChecks(10, [scene({ dialogue: [{ speaker: "flask", line: "Hi" }, { speaker: "ghost", line: "Boo" }], elementIds: ["mara", "kettle"] })], els);
    const refs = checks.find((c) => c.id === "references")!;
    expect(refs.status).toBe("fail");
    expect(refs.problems.join(" ")).toMatch(/flask.*not cast/);
    expect(refs.problems.join(" ")).toMatch(/ghost/);
    expect(refs.problems.join(" ")).toMatch(/kettle/);
  });

  it("marks a rule that failed before and passes now as fixed", () => {
    const first = runPlanChecks(20, [scene({ durationSec: 10 })], els);
    expect(status(first, "length")).toBe("fail");
    const second = runPlanChecks(20, [scene({ durationSec: 20 })], els, first);
    expect(status(second, "length")).toBe("fixed");
    expect(status(second, "headings")).toBe("pass");
  });
});

describe("export checks", () => {
  const base: ExportInput = {
    targetSec: 20,
    sceneNumbers: [1, 2],
    approvedLooks: { mara: 2 },
    sceneElements: { 1: ["mara"], 2: ["mara"] },
    clips: [
      { jobId: "J1", scene: 1, seconds: 10, lookVersions: { mara: 2 } },
      { jobId: "J2", scene: 2, seconds: 10, lookVersions: { mara: 2 } },
    ],
    cut: [
      { scene: 1, jobId: "J1", in: 0, out: 10 },
      { scene: 2, jobId: "J2", in: 0, out: 10 },
    ],
  };
  const st = (i: ExportInput, id: string) => runExportChecks(i).find((c) => c.id === id)!.status;

  it("passes a complete cut", () => {
    expect(runExportChecks(base).every((c) => c.status === "pass")).toBe(true);
  });
  it("fails a missing scene", () => {
    expect(st({ ...base, cut: base.cut.slice(0, 1) }, "coverage")).toBe("fail");
  });
  it("allows a 1 s trim but not 1.5 s", () => {
    expect(st({ ...base, cut: [base.cut[0]!, { ...base.cut[1]!, out: 9 }] }, "length")).toBe("pass");
    expect(st({ ...base, cut: [base.cut[0]!, { ...base.cut[1]!, out: 8.5 }] }, "length")).toBe("fail");
  });
  it("fails an empty clip or a trim past the source", () => {
    expect(st({ ...base, cut: [base.cut[0]!, { ...base.cut[1]!, in: 5, out: 5.2 }] }, "gaps")).toBe("fail");
    expect(st({ ...base, cut: [base.cut[0]!, { ...base.cut[1]!, out: 12 }] }, "gaps")).toBe("fail");
  });
  it("fails a clip built from an old look", () => {
    expect(st({ ...base, approvedLooks: { mara: 3 } }, "looks")).toBe("fail");
  });
});

describe("colours", () => {
  it("skips negated colours", () => {
    expect(extractColors("yellow raincoat, not red")).toEqual(["yellow"]);
    expect(extractColors("a blue coat instead of green")).toEqual(["blue"]);
  });
  it("lets the redo note win over the description", () => {
    expect(primaryColor("a red raincoat", "yellow raincoat, not red")).toBe(COLOR_WORDS.yellow);
    expect(primaryColor("a red raincoat", null)).toBe(COLOR_WORDS.red);
    expect(primaryColor("a raincoat")).toBeNull();
  });
});
