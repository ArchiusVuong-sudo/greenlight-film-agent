"use client";

import { ArrowLeft, Check, CircleDashed, FileText, FlaskConical, LayoutGrid, Loader2, Pause, Play, ReceiptText, Scissors, Square } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FilmState } from "@/lib/state";
import { Badge, Button, cx, Logo, ModeBadge, Progress, SyntheticPill } from "../ui";
import { AssistantPanel } from "./AssistantPanel";
import { BoardTab } from "./BoardTab";
import { runLabel, stages, type Stage } from "./derive";
import { EditorTab } from "./EditorTab";
import { EvalsTab } from "./EvalsTab";
import { LedgerDrawer } from "./LedgerDrawer";
import { ScriptTab } from "./ScriptTab";

export async function post(url: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = (await r.json().catch(() => ({}))) as { error?: string };
  return { ok: r.ok, error: d.error };
}

type Tab = "script" | "board" | "editor" | "evals";

export function Studio({ filmId }: { filmId: string }) {
  const [state, setState] = useState<FilmState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("board");
  const [ledger, setLedger] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/films/${filmId}`, { cache: "no-store" });
      const d = (await r.json()) as FilmState & { error?: string };
      if (!r.ok) throw new Error(d.error ?? "Could not load the film");
      setState(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [filmId]);

  useEffect(() => {
    let alive = true;
    const loop = async () => {
      await refresh();
      if (alive) timer.current = setTimeout(loop, 700);
    };
    void loop();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);

  if (!state) {
    return (
      <div className="grid h-screen place-items-center text-ink-300">
        {error ? (
          <div className="text-center">
            <p className="text-sm text-red-300">{error}</p>
            <Link href="/" className="mt-3 inline-block text-sm text-go-400 hover:underline">
              Back to New film
            </Link>
          </div>
        ) : (
          <Loader2 className="size-5 animate-spin" />
        )}
      </div>
    );
  }

  const run = runLabel(state);
  const active = state.activeRun;
  const canPause = !!active && !active.paused && (active.status === "running" || active.status === "queued");
  const canContinue = !!active?.paused || active?.status === "idle" || (!active && !state.cut);
  const budgetUse = state.film.budget ? state.money.committed / state.film.budget : 0;

  const tabs: { id: Tab; label: string; icon: React.ReactNode; badge?: React.ReactNode }[] = [
    { id: "script", label: "Script", icon: <FileText className="size-4" />, badge: state.planChecks.some((c) => c.status === "fail") ? <span className="size-1.5 rounded-full bg-red-400" /> : null },
    { id: "board", label: "Board", icon: <LayoutGrid className="size-4" /> },
    { id: "editor", label: "Editor", icon: <Scissors className="size-4" />, badge: state.cut ? <span className="size-1.5 rounded-full bg-go-400" /> : null },
    { id: "evals", label: "Evals", icon: <FlaskConical className="size-4" /> },
  ];

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-ink-700/80 bg-ink-900 px-4">
        <Link href="/" className="flex items-center gap-2 rounded-lg pr-2 text-ink-300 hover:text-ink-100" title="New film">
          <ArrowLeft className="size-4" />
          <Logo compact />
        </Link>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[15px] font-semibold tracking-tight">{state.film.title ?? "Untitled film"}</h1>
            <Badge tone={run.tone}>
              {run.tone === "blue" && <Loader2 className="size-3 animate-spin" />}
              {run.label}
            </Badge>
          </div>
          <p className="truncate text-xs text-ink-400">
            {state.film.targetSec} s - {state.film.aspect} - clips at {state.film.resolution}
            {state.film.logline ? ` - ${state.film.logline}` : ""}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <SyntheticPill />
          <ModeBadge mode={state.app.mode} model={state.activeRun?.model ?? state.runs.at(-1)?.model ?? state.app.model} reason={state.app.reason} />
          {!state.app.workerAlive && <Badge tone="red">Worker offline</Badge>}
          <button onClick={() => setLedger(true)} className="ml-2 flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-left hover:border-ink-600" title="Open the ledger">
            <div className="w-36">
              <div className="flex items-baseline justify-between text-[11px] text-ink-300">
                <span>Budget</span>
                <span className="font-mono text-ink-100">
                  {state.money.committed}
                  <span className="text-ink-400">/{state.film.budget} cr</span>
                </span>
              </div>
              <Progress value={budgetUse} tone={budgetUse > 1 ? "red" : budgetUse > 0.85 ? "amber" : "go"} className="mt-1" />
            </div>
            <ReceiptText className="size-4 text-ink-300" />
          </button>
          {canPause ? (
            <Button size="sm" onClick={() => post(`/api/films/${filmId}/control`, { action: "pause" }).then(refresh)} title="The next tool call returns 'paused' and the turn ends cleanly">
              <Pause className="size-3.5" /> Pause
            </Button>
          ) : (
            <Button size="sm" variant={active?.paused || active?.status === "idle" ? "primary" : "secondary"} disabled={!canContinue} onClick={() => post(`/api/films/${filmId}/control`, { action: "continue" }).then(refresh)}>
              <Play className="size-3.5" /> Continue
            </Button>
          )}
          {active && (
            <Button size="sm" variant="ghost" title="Stop the run" onClick={() => post(`/api/films/${filmId}/control`, { action: "stop" }).then(refresh)}>
              <Square className="size-3.5" />
            </Button>
          )}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[232px_minmax(0,1fr)_396px]">
        <aside className="scroll-thin min-h-0 overflow-y-auto border-r border-ink-700/80 bg-ink-900/60 p-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-300">Production</p>
          <ol className="space-y-1">
            {stages(state).map((st, i) => (
              <StageRow key={st.id} stage={st} index={i} />
            ))}
          </ol>
          <div className="mt-6 rounded-xl border border-ink-700 bg-ink-850 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-300">Brief</p>
            <p className="mt-2 text-xs leading-relaxed text-ink-200">{state.film.brief}</p>
            <div className="mt-3 flex flex-wrap gap-1">
              <Badge>{state.film.targetSec} s</Badge>
              <Badge>{state.film.aspect}</Badge>
              <Badge>{state.film.resolution}</Badge>
              <Badge>{state.film.budget} cr</Badge>
              {state.film.simulateTimeout && <Badge tone="amber">timeout drill</Badge>}
            </div>
          </div>
          {state.film.look && (
            <div className="mt-3 rounded-xl border border-ink-700 bg-ink-850 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-300">Look</p>
              <div className="mt-2 flex gap-1">
                {state.film.look.palette.map((c) => (
                  <span key={c} className="h-6 flex-1 rounded-md ring-1 ring-inset ring-white/10" style={{ background: c }} title={c} />
                ))}
              </div>
              <p className="mt-2 text-xs text-ink-200">{state.film.look.style}</p>
              <p className="mt-1 text-xs text-ink-400">{state.film.look.mood}</p>
            </div>
          )}
        </aside>

        <main className="flex min-h-0 flex-col">
          <nav className="flex h-11 shrink-0 items-center gap-1 border-b border-ink-700/80 px-3">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cx(
                  "relative flex h-8 items-center gap-2 rounded-lg px-3 text-sm transition",
                  tab === t.id ? "bg-ink-700 text-ink-100" : "text-ink-300 hover:bg-ink-800 hover:text-ink-100",
                )}
              >
                {t.icon}
                {t.label}
                {t.badge}
              </button>
            ))}
          </nav>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            {tab === "script" && <ScriptTab state={state} />}
            {tab === "board" && <BoardTab state={state} />}
            {tab === "editor" && <EditorTab state={state} filmId={filmId} refresh={refresh} />}
            {tab === "evals" && <EvalsTab />}
          </div>
        </main>

        <AssistantPanel state={state} filmId={filmId} refresh={refresh} />
      </div>

      {ledger && <LedgerDrawer state={state} onClose={() => setLedger(false)} />}
      {error && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-red-500/90 px-3 py-2 text-xs text-white">Connection problem: {error}</div>}
    </div>
  );
}

function StageRow({ stage, index }: { stage: Stage; index: number }) {
  const icon =
    stage.status === "done" ? (
      <span className="grid size-6 place-items-center rounded-full bg-go-500/15 text-go-400 ring-1 ring-go-500/40">
        <Check className="size-3.5" strokeWidth={3} />
      </span>
    ) : stage.status === "active" ? (
      <span className="grid size-6 place-items-center rounded-full bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/40">
        <Loader2 className="size-3.5 animate-spin" />
      </span>
    ) : stage.status === "waiting" ? (
      <span className="attention grid size-6 place-items-center rounded-full bg-amber-400 text-[11px] font-bold text-ink-950">!</span>
    ) : (
      <span className="grid size-6 place-items-center rounded-full text-ink-500 ring-1 ring-ink-600">
        <CircleDashed className="size-3.5" />
      </span>
    );
  return (
    <li className={cx("flex items-start gap-3 rounded-lg px-2 py-2", stage.status === "waiting" && "bg-amber-400/[0.07]")}>
      {icon}
      <div className="min-w-0">
        <p className={cx("text-sm font-medium", stage.status === "todo" ? "text-ink-400" : "text-ink-100")}>
          <span className="mr-1 text-ink-500">{index + 1}</span> {stage.label}
        </p>
        <p className="truncate text-[11px] text-ink-400">{stage.detail}</p>
      </div>
    </li>
  );
}
