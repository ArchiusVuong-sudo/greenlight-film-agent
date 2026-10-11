"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import type { FilmState } from "@/lib/state";
import { Badge, cx, fmtTime } from "../ui";

const KIND_TONE = { grant: "violet", hold: "blue", charge: "amber", release: "go" } as const;

export function LedgerDrawer({ state, onClose }: { state: FilmState; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sc = state.shotCost;
  const retried = state.jobs.filter((j) => j.attempts > 1 && j.status === "done");
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-[2px]" onClick={onClose}>
      <div className="fade-up flex h-full w-[560px] flex-col border-l border-ink-700 bg-ink-900 shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Ledger">
        <div className="flex items-center justify-between border-b border-ink-700 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Ledger</h2>
            <p className="text-xs text-ink-400">Quote, hold, charge. Synthetic credits.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-300 hover:bg-ink-700" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="grid grid-cols-4 gap-2 px-5 pt-4">
          <Card label="Budget" value={state.film.budget} />
          <Card label="Spent" value={state.money.spent} tone="amber" />
          <Card label="Held" value={state.money.held} tone="blue" />
          <Card label="Left" value={state.money.remaining} tone={state.money.remaining < 0 ? "red" : "go"} />
        </div>
        <div className="mx-5 mt-3 rounded-xl border border-ink-700 bg-ink-850 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-300">Cost per usable shot</p>
          {sc.perShot === null ? (
            <p className="mt-1 text-lg font-semibold text-ink-200">No usable shots yet</p>
          ) : (
            <p className="mt-1 text-2xl font-semibold">
              {sc.perShot} cr <span className="text-sm font-normal text-ink-300">per usable shot</span>
            </p>
          )}
          <p className="mt-1 text-xs text-ink-400">
            {sc.spent} cr spent / {sc.usableShots} usable shot{sc.usableShots === 1 ? "" : "s"}. Includes {sc.rejectedCredits} cr on rejected takes.
            {retried.length ? ` ${retried.map((j) => j.id).join(", ")} retried after a failure and ${retried.length === 1 ? "was" : "were"} charged once.` : ""}
          </p>
        </div>
        <div className="scroll-thin mt-4 min-h-0 flex-1 overflow-y-auto px-5 pb-6">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-ink-900 text-[10px] uppercase tracking-wide text-ink-400">
              <tr>
                <th className="w-16 py-2 font-medium">Time</th>
                <th className="w-20 py-2 font-medium">Entry</th>
                <th className="w-16 py-2 text-right font-medium">Credits</th>
                <th className="w-12 py-2 pl-3 font-medium">Job</th>
                <th className="py-2 pl-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {state.ledger.map((l) => (
                <tr key={l.id} className="border-t border-ink-800">
                  <td className="py-1.5 font-mono text-[10px] text-ink-400">{fmtTime(l.createdAt)}</td>
                  <td className="py-1.5">
                    <Badge tone={KIND_TONE[l.kind]}>{l.kind}</Badge>
                  </td>
                  <td className={cx("py-1.5 text-right font-mono", l.kind === "grant" || l.kind === "release" ? "text-go-400" : "text-ink-100")}>
                    {l.kind === "grant" || l.kind === "release" ? "+" : l.kind === "charge" ? "-" : ""}
                    {l.amount}
                  </td>
                  <td className="py-1.5 pl-3 font-mono text-[10px] text-ink-300">{l.jobId ?? ""}</td>
                  <td className="py-1.5 pl-2 text-[11px] text-ink-300">{l.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-ink-400">
            A hold reserves credits when a job is queued. It becomes a charge of the same amount on success, or is released if the job finally fails. Account balance: {state.account.available} of {state.account.granted} cr.
          </p>
        </div>
      </div>
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: number; tone?: "amber" | "blue" | "go" | "red" }) {
  const color = tone === "amber" ? "text-amber-200" : tone === "blue" ? "text-sky-300" : tone === "go" ? "text-go-400" : tone === "red" ? "text-red-300" : "text-ink-100";
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-ink-400">{label}</p>
      <p className={cx("font-mono text-lg font-semibold", color)}>
        {value}
        <span className="ml-0.5 text-[11px] font-normal text-ink-400">cr</span>
      </p>
    </div>
  );
}
