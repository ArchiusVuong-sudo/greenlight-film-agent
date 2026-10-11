"use client";

import { CheckCircle2, CircleAlert, FileText, Wrench } from "lucide-react";
import type { FilmState } from "@/lib/state";
import type { CheckResult } from "@/lib/types";
import { Badge, cx, Empty, SectionTitle } from "../ui";

export function ScriptTab({ state }: { state: FilmState }) {
  const names = new Map(state.elements.map((e) => [e.id, e.name]));
  const total = state.scenes.reduce((a, s) => a + s.durationSec, 0);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-6 p-6">
      <div>
        {state.scenes.length === 0 ? (
          <Empty icon={<FileText className="size-6" />} title="No script yet">
            The assistant writes the scenes through the writeScenes tool. They show up here as soon as it does.
          </Empty>
        ) : (
          <div className="mx-auto max-w-[640px] rounded-xl bg-[#f4f1ea] px-12 py-10 text-[#1d1c1a] shadow-2xl shadow-black/40" style={{ fontFamily: "var(--font-script)" }}>
            <p className="text-center text-sm font-bold uppercase tracking-wide">{state.film.title ?? "Untitled"}</p>
            <p className="mb-8 text-center text-xs text-[#6b665c]">
              {state.scenes.length} scenes - {total} s - synthetic spec script
            </p>
            {state.scenes.map((s) => (
              <div key={s.n} className="mb-7 fade-up">
                <div className="flex items-baseline justify-between gap-4">
                  <p className="text-[13px] font-bold uppercase">
                    {s.n}. {s.heading}
                  </p>
                  <span className="shrink-0 text-[11px] text-[#7d776b]">
                    {s.durationSec} s - {s.cameraMove}
                  </span>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed">{s.action}</p>
                {s.dialogue.map((d, i) => (
                  <div key={i} className="mx-auto mt-3 w-[70%]">
                    <p className="text-center text-[13px] font-bold uppercase">
                      {names.get(d.speaker) ?? d.speaker}
                      {d.vo ? " (V.O.)" : ""}
                    </p>
                    <p className="text-[13px] leading-relaxed">{d.line}</p>
                  </div>
                ))}
                <p className="mt-2 text-[10px] uppercase tracking-wide text-[#8b8577]">In shot: {s.elementIds.map((id) => names.get(id) ?? id).join(", ")}</p>
              </div>
            ))}
          </div>
        )}
      </div>
      <aside>
        <ChecksPanel title="Plan checks" checks={state.planChecks} hint="Run by code on every writeScenes and upsertElements call." />
      </aside>
    </div>
  );
}

export function ChecksPanel({ title, checks, hint }: { title: string; checks: CheckResult[]; hint?: string }) {
  const failing = checks.filter((c) => c.status === "fail").length;
  return (
    <div className="sticky top-6 rounded-xl border border-ink-700 bg-ink-900 p-4">
      <SectionTitle right={checks.length ? <Badge tone={failing ? "red" : "go"}>{failing ? `${failing} failing` : "all pass"}</Badge> : null}>{title}</SectionTitle>
      {checks.length === 0 ? (
        <p className="text-xs text-ink-400">No checks have run yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {checks.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              {c.status === "fail" ? (
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-red-400" />
              ) : c.status === "fixed" ? (
                <Wrench className="mt-0.5 size-4 shrink-0 text-sky-300" />
              ) : (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-go-400" />
              )}
              <div className="min-w-0">
                <p className={cx("text-[13px]", c.status === "fail" ? "text-red-200" : "text-ink-100")}>
                  {c.label}
                  {c.status === "fixed" && <span className="ml-1.5 text-[11px] text-sky-300">fixed</span>}
                </p>
                {c.problems.map((p, i) => (
                  <p key={i} className="mt-0.5 text-[11px] leading-snug text-ink-300">
                    {p}
                  </p>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      {hint && <p className="mt-4 border-t border-ink-700 pt-3 text-[11px] text-ink-400">{hint}</p>}
    </div>
  );
}
