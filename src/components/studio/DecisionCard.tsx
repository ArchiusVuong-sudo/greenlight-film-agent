"use client";

import { CircleDollarSign, Eye, HelpCircle, Loader2, RotateCcw, ThumbsUp } from "lucide-react";
import { useState } from "react";
import type { FilmState } from "@/lib/state";
import type { Decision, DecisionAnswer } from "@/lib/types";
import { Badge, Button, cx } from "../ui";
import { assetUrl, latestLook } from "./derive";
import { post } from "./Studio";

/** The recorded run's answer to this card (replay mode only). */
function recordedHint(state: FilmState, d: Decision): string | null {
  return state.replayHints.find((h) => new RegExp(`card ${d.id}\\b`).test(h) || (d.payload.quoteId ? h.includes(`quote ${d.payload.quoteId} `) : false)) ?? null;
}

export function DecisionCard({ state, d, filmId, refresh }: { state: FilmState; d: Decision; filmId: string; refresh: () => Promise<void> }) {
  const hint = recordedHint(state, d);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(answer: DecisionAnswer) {
    setBusy(true);
    setError(null);
    const r = await post(`/api/films/${filmId}/decisions/${d.id}`, answer);
    if (!r.ok) setError(r.error ?? "Could not send the answer");
    await refresh();
    setBusy(false);
  }

  const head =
    d.kind === "look"
      ? { icon: <Eye className="size-4" />, title: "Approve the looks", tone: "text-sky-300" }
      : d.kind === "budget"
        ? { icon: <CircleDollarSign className="size-4" />, title: "Budget decision", tone: "text-amber-300" }
        : { icon: <HelpCircle className="size-4" />, title: "Question", tone: "text-violet-300" };

  return (
    <div className="fade-up attention rounded-xl border border-amber-400/40 bg-gradient-to-b from-amber-400/[0.08] to-ink-900 p-3.5">
      <div className="mb-2 flex items-center justify-between">
        <p className={cx("flex items-center gap-2 text-sm font-semibold", head.tone)}>
          {head.icon}
          {head.title}
        </p>
        <span className="font-mono text-[10px] text-ink-400">
          {d.id}
          {d.openedBy === "server" ? " - opened by the server" : ""}
        </span>
      </div>
      <p className="text-[13px] leading-relaxed text-ink-100">{d.message}</p>
      {d.kind === "look" ? (
        <LookForm state={state} d={d} busy={busy} onSend={send} hint={hint} />
      ) : (
        <OptionForm state={state} d={d} busy={busy} onSend={send} hint={hint} />
      )}
      {hint && <p className="mt-2 text-[11px] leading-snug text-amber-200/80">Replay: the recorded run continues the way its director answered. The recorded choice is marked.</p>}
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}

function LookForm({ state, d, busy, onSend, hint }: { state: FilmState; d: Decision; busy: boolean; onSend: (a: DecisionAnswer) => void; hint: string | null }) {
  const ids = d.payload.elementIds ?? [];
  const [verdicts, setVerdicts] = useState<Record<string, { verdict: "approve" | "redo"; note: string }>>(() =>
    Object.fromEntries(
      ids.map((id) => {
        const m = hint?.match(new RegExp(`${id} \\(take \\d+\\) with the note "([^"]*)"`));
        return [id, m ? { verdict: "redo" as const, note: m[1]! } : { verdict: "approve" as const, note: "" }];
      }),
    ),
  );
  const names = new Map(state.elements.map((e) => [e.id, e]));
  const redoMissingNote = Object.values(verdicts).some((v) => v.verdict === "redo" && !v.note.trim());
  return (
    <div className="mt-3 space-y-2">
      {ids.map((id) => {
        const look = latestLook(state, id);
        const v = verdicts[id] ?? { verdict: "approve" as const, note: "" };
        const el = names.get(id);
        return (
          <div key={id} className="flex gap-3 rounded-lg bg-ink-850 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {look?.assetId ? <img src={assetUrl(look.assetId)!} alt={el?.name ?? id} className="size-[72px] shrink-0 rounded-md object-cover" /> : <div className="size-[72px] rounded-md bg-ink-700" />}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium">{el?.name ?? id}</p>
                <span className="text-[10px] text-ink-400">take {look?.version}</span>
              </div>
              <div className="mt-1.5 flex gap-1">
                <button
                  type="button"
                  onClick={() => setVerdicts((s) => ({ ...s, [id]: { ...v, verdict: "approve" } }))}
                  className={cx("flex items-center gap-1 rounded-md px-2 py-1 text-xs", v.verdict === "approve" ? "bg-go-500/20 text-go-300 ring-1 ring-go-500/40" : "text-ink-300 hover:bg-ink-700")}
                >
                  <ThumbsUp className="size-3" /> Approve
                </button>
                <button
                  type="button"
                  onClick={() => setVerdicts((s) => ({ ...s, [id]: { ...v, verdict: "redo" } }))}
                  className={cx("flex items-center gap-1 rounded-md px-2 py-1 text-xs", v.verdict === "redo" ? "bg-amber-400/20 text-amber-200 ring-1 ring-amber-400/40" : "text-ink-300 hover:bg-ink-700")}
                >
                  <RotateCcw className="size-3" /> Redo
                </button>
              </div>
              {v.verdict === "redo" && (
                <input
                  autoFocus
                  value={v.note}
                  onChange={(e) => setVerdicts((s) => ({ ...s, [id]: { ...v, note: e.target.value } }))}
                  placeholder="Note for the redo, e.g. yellow raincoat, not red"
                  className="mt-1.5 w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-xs outline-none focus:border-amber-400/60"
                  aria-label={`Redo note for ${el?.name ?? id}`}
                />
              )}
            </div>
          </div>
        );
      })}
      <Button
        variant="primary"
        size="sm"
        className="w-full"
        disabled={busy || redoMissingNote}
        onClick={() => onSend({ kind: "look", looks: ids.map((id) => ({ elementId: id, verdict: verdicts[id]!.verdict, note: verdicts[id]!.note || undefined })) })}
      >
        {busy && <Loader2 className="size-3.5 animate-spin" />}
        {Object.values(verdicts).some((v) => v.verdict === "redo") ? "Send verdicts" : "Approve all"}
      </Button>
    </div>
  );
}

function OptionForm({ state, d, busy, onSend, hint }: { state: FilmState; d: Decision; busy: boolean; onSend: (a: DecisionAnswer) => void; hint: string | null }) {
  const [note, setNote] = useState("");
  const quote = d.payload.quoteId;
  const left = state.money.remaining;
  return (
    <div className="mt-3 space-y-2">
      {d.kind === "budget" && (
        <div className="grid grid-cols-3 gap-1.5 text-center">
          <Stat label="Budget" value={`${state.film.budget} cr`} />
          <Stat label="Committed" value={`${state.money.committed} cr`} />
          <Stat label="Left" value={`${left} cr`} />
        </div>
      )}
      {(d.payload.options ?? []).map((o) => {
        const fits = typeof o.estimateCredits === "number" ? o.estimateCredits <= left : null;
        const recorded = !!hint && (hint.includes(`(option ${o.id})`) || (o.id === "approve-quote" && hint.startsWith("Director approved quote")));
        return (
          <button
            key={o.id}
            disabled={busy}
            onClick={() => onSend({ kind: "option", optionId: o.id, note: note || undefined })}
            className={cx(
              "group w-full rounded-lg border bg-ink-850 px-3 py-2 text-left transition hover:border-go-500/50 hover:bg-go-500/[0.06] disabled:opacity-50",
              recorded ? "border-amber-300/60" : "border-ink-600",
            )}
          >
            {recorded && <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-amber-300">Recorded choice</span>}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-ink-100">{o.label}</span>
              {typeof o.estimateCredits === "number" && (
                <Badge tone={o.id === "approve-quote" ? "red" : fits ? "go" : "red"}>
                  {o.estimateCredits} cr{o.id === "approve-quote" ? "" : fits ? ", fits" : ", over"}
                </Badge>
              )}
            </div>
            {o.detail && <p className="mt-0.5 text-[11px] leading-snug text-ink-400">{o.detail}</p>}
          </button>
        );
      })}
      {quote && <p className="text-[11px] text-ink-400">Quote {quote} is single use and expires 10 minutes after it was made.</p>}
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note to the assistant" className="w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1.5 text-xs outline-none focus:border-go-500/60" aria-label="Note" />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-ink-850 px-2 py-1.5">
      <p className="text-[10px] text-ink-400">{label}</p>
      <p className="font-mono text-xs text-ink-100">{value}</p>
    </div>
  );
}
