"use client";

import { Bot, ChevronDown, ChevronRight, Cpu, Info, UserRound, Wrench } from "lucide-react";
import { useState } from "react";
import type { ActivityRow } from "@/lib/activity";
import type { FilmState } from "@/lib/state";
import { Badge, cx, fmtMs, fmtTime, fmtTokens } from "../ui";

type Filter = "all" | "turn" | "tool" | "job" | "error";

const ICONS = { turn: Bot, tool: Wrench, job: Cpu, director: UserRound, system: Info } as const;

/** Every model turn, tool call and job event, grouped by run with time, credits, tokens and errors. */
export function ActivityView({ state }: { state: FilmState }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const runs = state.runs;

  const groupOf = (a: ActivityRow): string => {
    if (a.runId) return a.runId;
    const r = [...runs].reverse().find((x) => a.ts >= x.startedAt && (!x.endedAt || a.ts <= x.endedAt + 2000));
    return r?.id ?? "other";
  };
  const shown = state.activity.filter((a) => (filter === "all" ? true : filter === "error" ? a.status === "error" || a.status === "refused" : a.kind === filter));
  const groups = [...runs.map((r) => r.id), "other"].map((id) => ({ id, rows: shown.filter((a) => groupOf(a) === id) })).filter((g) => g.rows.length || runs.some((r) => r.id === g.id));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 gap-1 border-b border-ink-700/80 px-3 py-2">
        {(["all", "turn", "tool", "job", "error"] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cx("rounded-md px-2 py-1 text-[11px] capitalize", filter === f ? "bg-ink-600 text-ink-100" : "text-ink-300 hover:bg-ink-800")}>
            {f === "turn" ? "Model" : f === "error" ? "Errors" : f === "all" ? "All" : f === "tool" ? "Tools" : "Jobs"}
          </button>
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2">
        {groups.length === 0 && <p className="p-6 text-center text-xs text-ink-400">No activity yet.</p>}
        {groups.map((g, gi) => {
          const run = runs.find((r) => r.id === g.id);
          const collapsed = open[g.id] === false;
          const credits = g.rows.filter((r) => r.kind === "job" && r.status === "ok").reduce((a, r) => a + (r.credits ?? 0), 0);
          return (
            <div key={g.id} className="mb-3 overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
              <button onClick={() => setOpen((s) => ({ ...s, [g.id]: collapsed }))} className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-ink-850">
                {collapsed ? <ChevronRight className="mt-0.5 size-4 text-ink-400" /> : <ChevronDown className="mt-0.5 size-4 text-ink-400" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium">{run ? `Run ${gi + 1}` : "Director and editor"}</span>
                    {run && <Badge tone={run.provider === "live" ? "go" : "amber"}>{run.provider === "live" ? "live" : "replay of a recorded run"}</Badge>}
                    {run && <Badge tone={run.status === "error" ? "red" : run.status === "done" ? "go" : "neutral"}>{run.status}</Badge>}
                  </div>
                  {run && (
                    <p className="mt-1 font-mono text-[10px] leading-relaxed text-ink-400">
                      {run.model ?? "default model"} - {run.turns} turns - {fmtTokens(run.tokensIn + run.tokensCache)} in / {fmtTokens(run.tokensOut)} out tokens
                      {run.costUsd > 0 ? ` - est. $${run.costUsd.toFixed(3)}${run.provider === "replay" ? " (recorded)" : ""}` : ""} - {credits} cr charged
                      {run.endedAt ? ` - ${fmtMs(run.endedAt - run.startedAt)}` : ""}
                    </p>
                  )}
                </div>
              </button>
              {!collapsed && (
                <ul className="border-t border-ink-700/70">
                  {g.rows.map((a) => (
                    <Row key={a.id} a={a} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Row({ a }: { a: ActivityRow }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = ICONS[a.kind];
  const bad = a.status === "error";
  const refused = a.status === "refused";
  return (
    <li className={cx("border-b border-ink-800 last:border-0", bad && "bg-red-500/[0.07]", refused && "bg-amber-400/[0.06]")}>
      <button onClick={() => setExpanded((e) => !e)} className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-white/[0.02]">
        <Icon className={cx("mt-0.5 size-3.5 shrink-0", a.kind === "turn" ? "text-go-400" : a.kind === "tool" ? "text-sky-300" : a.kind === "job" ? "text-violet-300" : "text-ink-300", bad && "text-red-400")} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={cx("shrink-0 font-mono text-[11px] font-medium", bad ? "text-red-300" : refused ? "text-amber-300" : "text-ink-100")}>{a.name}</span>
            <span className={cx("truncate text-[11px]", bad ? "text-red-200" : "text-ink-300")}>{a.summary}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 font-mono text-[10px] text-ink-400">
          {a.tokensIn ? <span title="Tokens in / out">{fmtTokens(a.tokensIn)}/{fmtTokens(a.tokensOut ?? 0)}</span> : null}
          {a.credits ? <span className="text-amber-200">{a.credits} cr</span> : null}
          {a.durationMs !== null && a.durationMs !== undefined ? <span>{fmtMs(a.durationMs)}</span> : null}
          <span>{fmtTime(a.ts)}</span>
        </div>
      </button>
      {expanded && (
        <div className="px-3 pb-2 pl-8">
          <p className="mb-1 whitespace-pre-wrap text-[11px] text-ink-200">{a.summary}</p>
          {a.detail !== null && a.detail !== undefined && <pre className="scroll-thin max-h-56 overflow-auto rounded-md bg-ink-950 p-2 font-mono text-[10px] leading-relaxed text-ink-300">{JSON.stringify(a.detail, null, 2)}</pre>}
        </div>
      )}
    </li>
  );
}
