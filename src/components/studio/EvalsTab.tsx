"use client";

import { Check, FlaskConical, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { EvalReport } from "@/evals/report";
import { Badge, cx, Empty, fmtMs, fmtTokens } from "../ui";

export function EvalsTab() {
  const [report, setReport] = useState<EvalReport | null | undefined>(undefined);
  useEffect(() => {
    fetch("/api/evals")
      .then((r) => r.json())
      .then((d: { report: EvalReport | null }) => setReport(d.report))
      .catch(() => setReport(null));
  }, []);

  if (report === undefined)
    return (
      <div className="grid place-items-center p-12 text-ink-400">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  if (report === null)
    return (
      <div className="p-6">
        <Empty icon={<FlaskConical className="size-6" />} title="No eval report yet">
          Run <code className="rounded bg-ink-700 px-1">npm run eval</code> to score six synthetic briefs on the plan checks and the trace checks.
        </Empty>
      </div>
    );

  const traceIds = report.results[0]?.trace.map((t) => ({ id: t.id, label: t.label })) ?? [];
  return (
    <div className="space-y-4 p-6">
      <div className="flex items-start justify-between rounded-xl border border-ink-700 bg-ink-900 p-4">
        <div>
          <h2 className="text-base font-semibold">Six synthetic briefs, scored by code</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-400">
            Each brief runs through the assistant with an auto-director (approve looks, pick a budget option that fits, never approve spend over budget). Plan checks score what it wrote; trace checks score how it behaved.
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl font-semibold text-go-400">{Math.round(report.meanScore * 100)}%</p>
          <p className="text-[11px] text-ink-400">mean score</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-[11px] text-ink-300">
        <Badge>Run {new Date(report.ranAt).toLocaleString()}</Badge>
        <Badge tone={report.provider === "live" ? "go" : "amber"}>{report.provider === "live" ? "live model" : "replay of recorded runs"}</Badge>
        <Badge>{report.model}</Badge>
        <Badge>{report.results.length} briefs</Badge>
        <Badge>
          {fmtTokens(report.results.reduce((a, r) => a + r.tokensIn, 0))} in / {fmtTokens(report.results.reduce((a, r) => a + r.tokensOut, 0))} out tokens
        </Badge>
      </div>
      <div className="overflow-hidden rounded-xl border border-ink-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-ink-850 text-[10px] uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-3 py-2.5 font-medium">Brief</th>
              <th className="px-2 py-2.5 font-medium">Plan checks</th>
              {traceIds.map((t) => (
                <th key={t.id} className="w-[92px] px-2 py-2.5 font-medium normal-case tracking-normal" title={t.label}>
                  {t.label}
                </th>
              ))}
              <th className="px-2 py-2.5 text-right font-medium">Credits</th>
              <th className="px-2 py-2.5 text-right font-medium">Time</th>
              <th className="px-3 py-2.5 text-right font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {report.results.map((r) => {
              const planPass = r.plan.filter((p) => p.status !== "fail").length;
              return (
                <tr key={r.briefId} className="border-t border-ink-800 bg-ink-900 align-top">
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-ink-100">{r.title}</p>
                    <p className="text-[10px] text-ink-400">
                      {r.toolCalls} tool calls, {r.turns} turns{r.error ? `, error: ${r.error}` : ""}
                    </p>
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex gap-0.5" title={r.plan.map((p) => `${p.label}: ${p.status}`).join("\n")}>
                      {r.plan.map((p) => (
                        <span key={p.id} className={cx("h-4 w-2 rounded-sm", p.status === "fail" ? "bg-red-400" : "bg-go-500")} />
                      ))}
                    </div>
                    <p className="mt-1 text-[10px] text-ink-400">
                      {planPass}/{r.plan.length || 5}
                    </p>
                  </td>
                  {r.trace.map((t) => (
                    <td key={t.id} className="px-2 py-2.5" title={t.note}>
                      {t.pass ? <Check className="size-4 text-go-400" /> : <X className="size-4 text-red-400" />}
                      <p className="mt-0.5 text-[10px] leading-snug text-ink-400">{t.note}</p>
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono text-ink-200">
                    {r.creditsSpent}/{r.budget}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono text-ink-300">{fmtMs(r.durationMs)}</td>
                  <td className="px-3 py-2.5 text-right font-mono font-semibold text-ink-100">
                    {r.passed}/{r.total}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-ink-400">Numbers come from the last npm run eval and its saved report (evals/report.json). Briefs, names and renders are synthetic.</p>
    </div>
  );
}
