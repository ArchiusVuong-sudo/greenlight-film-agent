"use client";

import { Download, Layers, Pause, Play, RotateCcw, Scissors } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FilmState } from "@/lib/state";
import type { CutItem } from "@/lib/types";
import { Badge, Button, cx, Empty, fmtSec, SectionTitle } from "../ui";
import { aspectClass } from "./BoardTab";
import { assetUrl } from "./derive";
import { ChecksPanel } from "./ScriptTab";
import { post } from "./Studio";

export function EditorTab({ state, filmId, refresh }: { state: FilmState; filmId: string; refresh: () => Promise<void> }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clipsDone = state.jobs.filter((j) => j.kind === "clip" && j.status === "done").length;

  async function assemble() {
    setError(null);
    const r = await post(`/api/films/${filmId}/cut`, { action: "assemble" });
    if (!r.ok) setError(r.error ?? "Could not assemble");
    await refresh();
  }

  if (!state.cut) {
    return (
      <div className="p-6">
        <Empty icon={<Layers className="size-6" />} title="No cut yet">
          <p>The assistant assembles the cut when every clip is done. You can also assemble the finished clips yourself.</p>
          <div className="mt-4">
            <Button variant="primary" size="sm" disabled={clipsDone === 0} onClick={assemble}>
              <Scissors className="size-3.5" /> Assemble {clipsDone} finished clip{clipsDone === 1 ? "" : "s"}
            </Button>
          </div>
          {error && <p className="mt-3 text-red-300">{error}</p>}
        </Empty>
      </div>
    );
  }

  const cut = state.cut;
  const sel = cut.find((c) => c.scene === selected) ?? null;
  return (
    <div className="space-y-5 p-6">
      <section className="rounded-xl border border-ink-700 bg-ink-900 p-4">
        <SectionTitle
          right={
            <div className="flex items-center gap-2">
              <Badge tone={Math.abs(state.cutLength - state.film.targetSec) <= 1 ? "go" : "red"}>
                {fmtSec(state.cutLength)} of {state.film.targetSec} s
              </Badge>
              <Button size="sm" variant="ghost" onClick={assemble} title="Rebuild the cut from the newest clips">
                <RotateCcw className="size-3.5" /> Re-assemble
              </Button>
            </div>
          }
        >
          Timeline
        </SectionTitle>
        <Timeline state={state} cut={cut} selected={selected} onSelect={setSelected} />
        {sel ? (
          <TrimControls key={sel.scene} item={sel} state={state} filmId={filmId} refresh={refresh} />
        ) : (
          <p className="mt-3 text-xs text-ink-400">Select a clip to trim its in and out points. Export checks re-run on every change.</p>
        )}
      </section>
      <div className="grid grid-cols-[minmax(0,1fr)_280px] gap-5">
        <Animatic state={state} cut={cut} />
        <aside className="space-y-3">
          <ChecksPanel title="Export checks" checks={state.exportChecks} hint="Run by code on every change to the cut." />
          <a href={`/api/films/${filmId}/export`} className="block">
            <Button variant="primary" className="w-full" disabled={state.exportChecks.some((c) => c.status === "fail")}>
              <Download className="size-4" /> Export project JSON
            </Button>
          </a>
        </aside>
      </div>
    </div>
  );
}

function Timeline({ state, cut, selected, onSelect }: { state: FilmState; cut: CutItem[]; selected: number | null; onSelect: (n: number) => void }) {
  const span = Math.max(state.film.targetSec + 1, state.cutLength);
  const clips = new Map(state.jobs.map((j) => [j.id, j]));
  let t = 0;
  const ticks = Array.from({ length: Math.floor(span / 5) + 1 }, (_, i) => i * 5);
  return (
    <div>
      <div className="relative mb-1 h-4 text-[10px] text-ink-400">
        {ticks.map((s) => (
          <span key={s} className="absolute -translate-x-1/2 font-mono" style={{ left: `${(s / span) * 100}%` }}>
            {s}s
          </span>
        ))}
      </div>
      <div className="relative h-[86px] rounded-lg bg-ink-850 p-1">
        <div className="absolute bottom-0 top-0 z-10 w-px bg-go-400/60" style={{ left: `${(state.film.targetSec / span) * 100}%` }} title={`Target ${state.film.targetSec} s`} />
        <div className="flex h-full gap-0.5">
          {cut.map((item) => {
            const len = item.out - item.in;
            const left = t;
            t += len;
            const job = clips.get(item.jobId);
            const scene = state.scenes.find((s) => s.n === item.scene);
            const img = assetUrl(job?.assetId);
            return (
              <button
                key={item.scene}
                onClick={() => onSelect(item.scene)}
                title={`Scene ${item.scene}: ${fmtSec(left)} - ${fmtSec(left + len)}`}
                className={cx(
                  "relative h-full overflow-hidden rounded-md text-left ring-2 transition",
                  selected === item.scene ? "ring-go-400" : "ring-transparent hover:ring-ink-500",
                )}
                style={{ width: `${(len / span) * 100}%`, background: "#1f2430" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {img && <img src={img} alt="" className="absolute inset-0 size-full object-cover opacity-70" />}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                <div className="absolute bottom-1.5 left-2 right-2">
                  <p className="font-mono text-[11px] font-semibold text-white">S{item.scene}</p>
                  <p className="truncate text-[10px] text-white/75">
                    {fmtSec(len)} - {scene?.cameraMove}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TrimControls({ item, state, filmId, refresh }: { item: CutItem; state: FilmState; filmId: string; refresh: () => Promise<void> }) {
  const job = state.jobs.find((j) => j.id === item.jobId);
  const max = job?.seconds ?? item.out;
  const [inS, setIn] = useState(item.in);
  const [outS, setOut] = useState(item.out);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const send = (a: number, b: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void post(`/api/films/${filmId}/cut`, { action: "trim", scene: item.scene, in: a, out: b }).then(refresh), 150);
  };
  return (
    <div className="mt-4 grid grid-cols-[auto_1fr_1fr] items-center gap-5 rounded-lg border border-ink-700 bg-ink-850 px-4 py-3">
      <div>
        <p className="text-sm font-medium">Scene {item.scene}</p>
        <p className="text-[11px] text-ink-400">
          Clip {item.jobId}, {max} s source
        </p>
      </div>
      <Slider label="In" value={inS} min={0} max={max} onChange={(v) => { const a = Math.min(v, outS - 0.5); setIn(a); send(a, outS); }} />
      <Slider label="Out" value={outS} min={0} max={max} onChange={(v) => { const b = Math.max(v, inS + 0.5); setOut(b); send(inS, b); }} />
    </div>
  );
}

function Slider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="mb-1 flex justify-between text-[11px] text-ink-300">
        <span>{label} point</span>
        <span className="font-mono text-ink-100">{value.toFixed(1)} s</span>
      </div>
      <input type="range" min={min} max={max} step={0.1} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--color-go-500)]" aria-label={`${label} point`} />
    </label>
  );
}

/** Plays the cut: each clip's frame with its camera move, captions from the dialogue. */
function Animatic({ state, cut }: { state: FilmState; cut: CutItem[] }) {
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const raf = useRef<number | null>(null);
  const last = useRef<number | null>(null);
  const total = useMemo(() => cut.reduce((a, c) => a + Math.max(0, c.out - c.in), 0), [cut]);

  useEffect(() => {
    if (!playing) return;
    const step = (ts: number) => {
      if (last.current !== null) {
        const dt = (ts - last.current) / 1000;
        setTime((t) => {
          const n = t + dt;
          if (n >= total) {
            setPlaying(false);
            return total;
          }
          return n;
        });
      }
      last.current = ts;
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      last.current = null;
    };
  }, [playing, total]);

  let acc = 0;
  let idx = 0;
  for (let i = 0; i < cut.length; i++) {
    const len = cut[i]!.out - cut[i]!.in;
    if (time < acc + len || i === cut.length - 1) {
      idx = i;
      break;
    }
    acc += len;
  }
  const item = cut[idx];
  const scene = state.scenes.find((s) => s.n === item?.scene);
  const job = state.jobs.find((j) => j.id === item?.jobId);
  const local = item ? Math.max(0, time - acc) : 0;
  const len = item ? item.out - item.in : 1;
  const names = new Map(state.elements.map((e) => [e.id, e.name]));
  const line = scene?.dialogue.length ? scene.dialogue[Math.min(scene.dialogue.length - 1, Math.floor((local / len) * scene.dialogue.length))] : null;
  const wide = state.film.aspect === "16:9";

  return (
    <section className="rounded-xl border border-ink-700 bg-ink-900 p-4">
      <SectionTitle right={<span className="text-[11px] text-ink-400">Simulated renders, {state.film.aspect}</span>}>Animatic preview</SectionTitle>
      <div className={cx("flex gap-6", wide ? "flex-col" : "items-start")}>
        <div className={cx("relative shrink-0 overflow-hidden rounded-lg bg-black ring-1 ring-ink-700", aspectClass(state.film.aspect), wide ? "w-full" : state.film.aspect === "9:16" ? "w-[230px]" : "w-[320px]")}>
          {job?.assetId && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/assets/${job.assetId}`}
              alt={`Scene ${item?.scene}`}
              className="size-full object-cover will-change-transform"
              style={{ transform: moveTransform(scene?.cameraMove ?? "static", len ? local / len : 0) }}
            />
          )}
          {line && (
            <div className="absolute inset-x-3 bottom-8 text-center">
              <span className="rounded bg-black/70 px-2 py-1 text-[12px] leading-relaxed text-white">
                {line.vo ? <span className="italic">{line.line}</span> : <>{names.get(line.speaker) ?? line.speaker}: {line.line}</>}
              </span>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 flex h-1 gap-px bg-black/60">
            {cut.map((c, i) => {
              const l = c.out - c.in;
              const before = cut.slice(0, i).reduce((a, x) => a + x.out - x.in, 0);
              const fill = Math.max(0, Math.min(1, (time - before) / l));
              return (
                <div key={c.scene} className="h-full bg-white/20" style={{ width: `${(l / total) * 100}%` }}>
                  <div className="h-full bg-go-400" style={{ width: `${fill * 100}%` }} />
                </div>
              );
            })}
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => { if (time >= total) setTime(0); setPlaying((p) => !p); }} aria-label={playing ? "Pause" : "Play"}>
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              {playing ? "Pause" : "Play"}
            </Button>
            <Button variant="ghost" onClick={() => { setPlaying(false); setTime(0); }}>
              <RotateCcw className="size-4" /> Restart
            </Button>
            <span className="ml-1 whitespace-nowrap font-mono text-sm text-ink-200">
              {time.toFixed(1)} / {total.toFixed(1)} s
            </span>
          </div>
          {scene && (
            <div className="rounded-lg bg-ink-850 p-3">
              <p className="font-mono text-[11px] font-semibold text-ink-100">
                Scene {scene.n} - {scene.heading}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-ink-300">{scene.action}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** The camera move at progress p (0-1), matching the CSS keyframes used on the board. */
export function moveTransform(move: string, p: number): string {
  const k = Math.max(0, Math.min(1, p));
  switch (move) {
    case "push-in":
      return `scale(${1 + 0.14 * k})`;
    case "pull-out":
      return `scale(${1.14 - 0.14 * k})`;
    case "pan-left":
      return `scale(1.12) translateX(${4 - 8 * k}%)`;
    case "pan-right":
      return `scale(1.12) translateX(${-4 + 8 * k}%)`;
    case "tilt-up":
      return `scale(1.12) translateY(${4 - 8 * k}%)`;
    default:
      return `scale(${1.02 + 0.01 * k})`;
  }
}
