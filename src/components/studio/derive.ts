import type { FilmState } from "@/lib/state";
import type { JobRow, LookRow } from "@/lib/types";

export type StageStatus = "todo" | "active" | "waiting" | "done";

export interface Stage {
  id: string;
  label: string;
  status: StageStatus;
  detail: string;
}

export function latestLook(s: FilmState, elementId: string): LookRow | undefined {
  let out: LookRow | undefined;
  for (const l of s.looks) if (l.elementId === elementId && (!out || l.version > out.version)) out = l;
  return out;
}

export function lastJob(s: FilmState, kind: JobRow["kind"], target: string): JobRow | undefined {
  let out: JobRow | undefined;
  for (const j of s.jobs) if (j.kind === kind && j.target === target) out = j;
  return out;
}

const isActive = (j?: JobRow) => !!j && (j.status === "queued" || j.status === "running" || j.status === "retrying");

export function stages(s: FilmState): Stage[] {
  const open = s.decisions.filter((d) => d.status === "open");
  const running = !!s.activeRun && (s.activeRun.status === "running" || s.activeRun.status === "queued");
  const failing = s.planChecks.filter((c) => c.status === "fail").length;
  const estimated = s.activity.some((a) => a.kind === "tool" && a.name === "estimateCost" && a.status === "ok");
  const elements = s.elements;
  const approved = elements.filter((e) => ["approved", "reused"].includes(latestLook(s, e.id)?.status ?? "")).length;
  const scenes = s.scenes;
  const framesDone = scenes.filter((sc) => lastJob(s, "frame", String(sc.n))?.status === "done").length;
  const clipsDone = scenes.filter((sc) => lastJob(s, "clip", String(sc.n))?.status === "done").length;
  const exportOk = s.cut && s.exportChecks.every((c) => c.status !== "fail");

  const plan: Stage = {
    id: "plan",
    label: "Plan",
    status: scenes.length ? (failing ? "active" : "done") : running ? "active" : "todo",
    detail: scenes.length ? `${scenes.length} scenes, ${failing ? `${failing} checks failing` : "checks pass"}` : "Scenes and cast",
  };
  const budget: Stage = {
    id: "budget",
    label: "Budget",
    status: open.some((d) => d.kind === "budget") ? "waiting" : estimated ? "done" : scenes.length && running ? "active" : "todo",
    detail: open.some((d) => d.kind === "budget") ? "Waiting for your call" : estimated ? `${s.money.committed} of ${s.film.budget} cr committed` : "Estimate before spend",
  };
  const looks: Stage = {
    id: "looks",
    label: "Looks",
    status: open.some((d) => d.kind === "look")
      ? "waiting"
      : elements.length && approved === elements.length
        ? "done"
        : s.jobs.some((j) => j.kind === "reference" && isActive(j))
          ? "active"
          : "todo",
    detail: open.some((d) => d.kind === "look") ? "Waiting for your approval" : elements.length ? `${approved}/${elements.length} approved` : "Reference per element",
  };
  const frames: Stage = {
    id: "frames",
    label: "Frames",
    status: scenes.length && framesDone === scenes.length ? "done" : s.jobs.some((j) => j.kind === "frame" && isActive(j)) ? "active" : "todo",
    detail: scenes.length ? `${framesDone}/${scenes.length} rendered` : "First frame per scene",
  };
  const clips: Stage = {
    id: "clips",
    label: "Clips",
    status: scenes.length && clipsDone === scenes.length ? "done" : s.jobs.some((j) => j.kind === "clip" && isActive(j)) ? "active" : "todo",
    detail: scenes.length ? `${clipsDone}/${scenes.length} rendered` : "Frame plus a camera move",
  };
  const cut: Stage = {
    id: "cut",
    label: "Cut",
    status: exportOk ? "done" : s.cut ? "active" : "todo",
    detail: s.cut ? `${Math.round(s.cutLength * 10) / 10} s, ${exportOk ? "export checks pass" : "export checks failing"}` : "Timeline and export",
  };
  return [plan, budget, looks, frames, clips, cut];
}

export function runLabel(s: FilmState): { label: string; tone: "go" | "amber" | "red" | "neutral" | "blue" } {
  const r = s.activeRun;
  const last = s.runs.at(-1);
  if (r?.paused) return { label: "Paused", tone: "neutral" };
  if (r?.status === "queued") return { label: "Starting", tone: "blue" };
  if (r?.status === "running") return { label: "Working", tone: "blue" };
  if (r?.status === "waiting") return { label: "Waiting for you", tone: "amber" };
  if (r?.status === "idle") return { label: "Stopped, press Continue", tone: "amber" };
  if (last?.status === "error") return { label: "Run error", tone: "red" };
  if (s.cut) return { label: "Cut ready", tone: "go" };
  if (s.decisions.some((d) => d.status === "open")) return { label: "Waiting for you", tone: "amber" };
  return { label: last ? "Run ended" : "Not started", tone: "neutral" };
}

export function assetUrl(id: string | null | undefined): string | null {
  return id ? `/api/assets/${id}` : null;
}
