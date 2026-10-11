"use client";

import { ArrowRight, CircleDollarSign, Clock, Film as FilmIcon, Loader2, MonitorPlay, Sparkles, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DEFAULT_BRIEF, EVAL_BRIEFS, type Brief } from "@/lib/briefs";
import type { Aspect, Film, Resolution } from "@/lib/types";
import { Badge, Button, cx, Logo, ModeBadge, SyntheticPill } from "./ui";

interface AppInfo {
  mode: "live" | "replay";
  reason: string;
  workerAlive: boolean;
  model: string | null;
}

export function NewFilm() {
  const router = useRouter();
  const [form, setForm] = useState<Brief>(DEFAULT_BRIEF);
  const [films, setFilms] = useState<Film[]>([]);
  const [app, setApp] = useState<AppInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/films")
      .then((r) => r.json())
      .then((d: { films: Film[]; app: AppInfo }) => {
        setFilms(d.films);
        setApp(d.app);
      })
      .catch(() => setError("Could not reach the app server"));
  }, []);

  const set = <K extends keyof Brief>(k: K, v: Brief[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/films", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ briefId: form.briefId, brief: form.brief, targetSec: form.targetSec, aspect: form.aspect, resolution: form.resolution, budget: form.budget, simulateTimeout: form.simulateTimeout }),
      });
      const d = (await r.json()) as { id?: string; error?: string };
      if (!r.ok || !d.id) throw new Error(d.error ?? "Could not create the film");
      router.push(`/films/${d.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const replayMismatch = app?.mode === "replay" && form.brief !== EVAL_BRIEFS.find((b) => b.briefId === form.briefId)?.brief;

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_600px_at_70%_-10%,rgb(34_197_94/0.10),transparent),radial-gradient(900px_500px_at_0%_110%,rgb(240_164_58/0.08),transparent)]">
      <header className="flex h-14 items-center justify-between border-b border-ink-700/70 px-6">
        <Logo />
        <div className="flex items-center gap-2">
          <SyntheticPill />
          {app && <ModeBadge mode={app.mode} model={app.model} reason={app.reason} />}
          {app && !app.workerAlive && (
            <Badge tone="red" title="Start the app with npm start, which runs the web app and the worker together">
              Worker offline
            </Badge>
          )}
        </div>
      </header>

      <main className="mx-auto grid max-w-[1180px] grid-cols-[1fr_340px] gap-10 px-6 pb-16 pt-12">
        <section>
          <div className="mb-8">
            <p className="mb-3 inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-go-400">
              <Sparkles className="size-3.5" /> New film
            </p>
            <h1 className="text-[34px] font-semibold leading-tight tracking-tight">Hand the film to the assistant.</h1>
            <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-ink-300">
              It writes the scenes, prices every render against your budget and keeps working. It stops where the decisions are yours: spend over budget and the looks.
            </p>
          </div>

          <form onSubmit={submit} className="rounded-2xl border border-ink-700 bg-ink-900/80 p-6 shadow-2xl shadow-black/30 backdrop-blur">
            <label className="mb-2 block text-xs font-medium text-ink-300" htmlFor="brief">
              Brief
            </label>
            <textarea
              id="brief"
              value={form.brief}
              onChange={(e) => set("brief", e.target.value)}
              rows={4}
              className="w-full resize-none rounded-xl border border-ink-600 bg-ink-850 px-4 py-3 text-[15px] leading-relaxed text-ink-100 outline-none transition focus:border-go-500/60 focus:ring-2 focus:ring-go-500/20"
            />

            <div className="mt-5 grid grid-cols-4 gap-4">
              <Field label="Target length" icon={<Clock className="size-3.5" />}>
                <div className="flex items-center rounded-lg border border-ink-600 bg-ink-850 pr-3 focus-within:border-go-500/60">
                  <input type="number" min={5} max={120} value={form.targetSec} onChange={(e) => set("targetSec", Number(e.target.value))} className="w-full bg-transparent px-3 py-2 text-sm outline-none" />
                  <span className="text-xs text-ink-400">s</span>
                </div>
              </Field>
              <Field label="Aspect ratio" icon={<MonitorPlay className="size-3.5" />}>
                <Segmented<Aspect> value={form.aspect} options={["9:16", "16:9", "1:1"]} onChange={(v) => set("aspect", v)} />
              </Field>
              <Field label="Clip resolution" icon={<FilmIcon className="size-3.5" />}>
                <Segmented<Resolution> value={form.resolution} options={["720p", "1080p"]} onChange={(v) => set("resolution", v)} />
              </Field>
              <Field label="Credit budget" icon={<CircleDollarSign className="size-3.5" />}>
                <div className="flex items-center rounded-lg border border-ink-600 bg-ink-850 pr-3 focus-within:border-go-500/60">
                  <input type="number" min={1} max={1000} value={form.budget} onChange={(e) => set("budget", Number(e.target.value))} className="w-full bg-transparent px-3 py-2 text-sm outline-none" />
                  <span className="text-xs text-ink-400">cr</span>
                </div>
              </Field>
            </div>

            <label className="mt-5 flex cursor-pointer items-center gap-3 rounded-xl border border-ink-700 bg-ink-850/60 px-4 py-3 text-sm text-ink-200 hover:border-ink-600">
              <input type="checkbox" checked={form.simulateTimeout} onChange={(e) => set("simulateTimeout", e.target.checked)} className="size-4 accent-[var(--color-go-500)]" />
              <span>
                Simulate a provider timeout on the first clip
                <span className="block text-xs text-ink-400">The job fails once, retries on the same idempotency key and is charged once.</span>
              </span>
            </label>

            {replayMismatch && (
              <p className="mt-4 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                Replay mode plays a recorded live run of a sample brief. Edits to the brief do not change what the recorded assistant does.
              </p>
            )}
            {error && <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

            <div className="mt-6 flex items-center justify-between">
              <p className="text-xs text-ink-400">Demo balance: 1,000 synthetic credits. Renders are simulated SVG.</p>
              <Button type="submit" variant="primary" size="lg" disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                Hand it to the assistant
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </form>
        </section>

        <aside className="pt-[118px]">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-300">Sample briefs</h2>
          <div className="space-y-1.5">
            {EVAL_BRIEFS.map((b) => (
              <button
                key={b.briefId}
                type="button"
                onClick={() => setForm(b)}
                className={cx(
                  "w-full rounded-xl border px-3.5 py-2.5 text-left transition",
                  form.briefId === b.briefId ? "border-go-500/40 bg-go-500/[0.07]" : "border-ink-700 bg-ink-900/60 hover:border-ink-600",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-ink-100">{b.title}</span>
                  <span className="text-[11px] text-ink-400">
                    {b.targetSec} s, {b.aspect}, {b.budget} cr
                  </span>
                </div>
              </button>
            ))}
          </div>

          <h2 className="mb-3 mt-8 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-300">Recent films</h2>
          {films.length === 0 ? (
            <p className="text-xs text-ink-400">No films yet.</p>
          ) : (
            <div className="space-y-1.5">
              {films.slice(0, 5).map((f) => (
                <a key={f.id} href={`/films/${f.id}`} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-ink-200 hover:bg-ink-800">
                  <span className="truncate">{f.title ?? "Untitled film"}</span>
                  <span className="shrink-0 text-[11px] text-ink-400">{new Date(f.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </a>
              ))}
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

function Field({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink-300">
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: T[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-lg border border-ink-600 bg-ink-850 p-0.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={cx("flex-1 rounded-md px-2 py-1.5 text-sm transition", value === o ? "bg-ink-600 text-ink-100 shadow" : "text-ink-300 hover:text-ink-100")}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
