"use client";

import { Box, Clapperboard, ImageIcon, Library, MapPin, RotateCcw, User } from "lucide-react";
import type { FilmState } from "@/lib/state";
import type { ElementRow, JobRow } from "@/lib/types";
import { Badge, cx, Empty, Progress, SectionTitle } from "../ui";
import { assetUrl, lastJob, latestLook } from "./derive";

const KIND_ICON = { cast: User, location: MapPin, prop: Box } as const;

export function aspectClass(aspect: string): string {
  return aspect === "9:16" ? "aspect-[9/16]" : aspect === "16:9" ? "aspect-video" : "aspect-square";
}

export function BoardTab({ state }: { state: FilmState }) {
  const cols = state.film.aspect === "9:16" ? "grid-cols-4" : state.film.aspect === "16:9" ? "grid-cols-2" : "grid-cols-3";
  return (
    <div className="space-y-8 p-6">
      <section>
        <SectionTitle right={<span className="text-[11px] text-ink-400">Cast, locations and props with their looks</span>}>Elements</SectionTitle>
        {state.elements.length === 0 ? (
          <Empty icon={<User className="size-6" />} title="No elements yet">
            The assistant creates cast, location and prop elements with upsertElements.
          </Empty>
        ) : (
          <div className="grid grid-cols-5 gap-3">
            {state.elements.map((e) => (
              <ElementCard key={e.id} state={state} el={e} />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle right={<span className="text-[11px] text-ink-400">Hover a finished clip to preview its camera move</span>}>Scenes</SectionTitle>
        {state.scenes.length === 0 ? (
          <Empty icon={<Clapperboard className="size-6" />} title="No scenes yet">
            Scenes appear here as soon as the assistant writes them.
          </Empty>
        ) : (
          <div className={cx("grid gap-4", cols)}>
            {state.scenes.map((s) => (
              <SceneCard key={s.n} state={state} n={s.n} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ElementCard({ state, el }: { state: FilmState; el: ElementRow }) {
  const look = latestLook(state, el.id);
  const takes = state.looks.filter((l) => l.elementId === el.id);
  const job = look?.jobId ? state.jobs.find((j) => j.id === look.jobId) : undefined;
  const Icon = KIND_ICON[el.kind];
  const img = assetUrl(look?.assetId);
  const rejected = takes.filter((t) => t.status === "rejected");
  return (
    <div className="fade-up overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
      <div className="relative aspect-square bg-ink-850">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt={`${el.name}, take ${look?.version}`} className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center text-ink-500">
            <Icon className="size-8" />
          </div>
        )}
        {look?.status === "rendering" && (
          <div className="absolute inset-0 flex flex-col justify-end bg-ink-950/50 p-3">
            <div className="shimmer absolute inset-0" />
            <p className="mb-1.5 text-[11px] text-ink-200">Rendering take {look.version}</p>
            <Progress value={job?.progress ?? 0} />
          </div>
        )}
        {rejected.length > 0 && (
          <span className="absolute bottom-2 left-2 rounded-md bg-ink-950/80 px-1.5 py-0.5 text-[10px] text-ink-200">
            {takes.length} takes
          </span>
        )}
      </div>
      <div className="p-2.5">
        <div className="flex items-center gap-1.5">
          <Icon className="size-3.5 shrink-0 text-ink-400" />
          <p className="truncate text-sm font-medium">{el.name}</p>
        </div>
        <p className="mt-0.5 line-clamp-2 min-h-[30px] text-[11px] leading-snug text-ink-400">{el.description}</p>
        <div className="mt-2">
          <LookBadge state={state} elementId={el.id} />
        </div>
        {rejected.map((r) => (
          <p key={r.version} className="mt-1.5 flex items-start gap-1 text-[11px] text-ink-300">
            <RotateCcw className="mt-0.5 size-3 shrink-0 text-amber-300" /> Take {r.version} sent back: {r.note}
          </p>
        ))}
      </div>
    </div>
  );
}

export function LookBadge({ state, elementId }: { state: FilmState; elementId: string }) {
  const look = latestLook(state, elementId);
  if (!look) return <Badge>No look yet</Badge>;
  switch (look.status) {
    case "reused":
      return (
        <span className="inline-flex items-start gap-1 rounded-lg bg-violet-500/12 px-2 py-0.5 text-[11px] font-medium leading-snug text-violet-300 ring-1 ring-inset ring-violet-500/30">
          <Library className="mt-0.5 size-3 shrink-0" /> Reused from library, 0 cr
        </span>
      );
    case "approved":
      return <Badge tone="go">Approved, take {look.version}</Badge>;
    case "pending":
      return <Badge tone="amber">Waiting for approval</Badge>;
    case "rejected":
      return <Badge tone="amber">Redo requested</Badge>;
    case "rendering":
      return <Badge tone="blue">Rendering</Badge>;
    default:
      return <Badge tone="red">Render failed</Badge>;
  }
}

function SceneCard({ state, n }: { state: FilmState; n: number }) {
  const scene = state.scenes.find((s) => s.n === n)!;
  const frame = lastJob(state, "frame", String(n));
  const clip = lastJob(state, "clip", String(n));
  const img = assetUrl(clip?.status === "done" ? clip.assetId : frame?.status === "done" ? frame.assetId : null);
  return (
    <div className="hover-play fade-up overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
      <div className={cx("relative overflow-hidden bg-ink-850", state.film.aspect === "9:16" ? "aspect-[3/4]" : aspectClass(state.film.aspect))}>
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img}
            alt={`Scene ${n}`}
            className={cx("size-full object-cover object-[50%_70%]", clip?.status === "done" && `clip-move move-${scene.cameraMove}`)}
            style={{ animationDuration: "0s" }}
          />
        ) : (
          <div className="grid size-full place-items-center text-ink-500">
            <ImageIcon className="size-7" />
          </div>
        )}
        {clip?.status === "done" && <span className="absolute bottom-2 right-2 rounded-md bg-ink-950/80 px-1.5 py-0.5 text-[10px] text-ink-100">{scene.cameraMove} - {clip.resolution}</span>}
      </div>
      <div className="space-y-2 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate font-mono text-[11px] font-semibold text-ink-100">
            {n}. {scene.heading}
          </p>
          <span className="shrink-0 text-[11px] text-ink-400">{scene.durationSec} s</span>
        </div>
        <p className="line-clamp-2 text-[11px] leading-snug text-ink-300">{scene.action}</p>
        <JobLine label="Frame" job={frame} />
        <JobLine label="Clip" job={clip} />
      </div>
    </div>
  );
}

export function JobLine({ label, job }: { label: string; job?: JobRow }) {
  if (!job)
    return (
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-ink-400">{label}</span>
        <span className="text-ink-500">not started</span>
      </div>
    );
  const active = job.status === "queued" || job.status === "running" || job.status === "retrying";
  return (
    <div className="text-[11px]">
      <div className="flex items-center justify-between">
        <span className="text-ink-400">
          {label} <span className="font-mono text-ink-500">{job.id}</span>
        </span>
        <span className={cx(job.status === "done" ? "text-go-400" : job.status === "failed" ? "text-red-300" : job.status === "retrying" ? "text-amber-300" : "text-sky-300")}>
          {job.status === "done" ? `done, ${job.price} cr` : job.status === "retrying" ? "retrying" : job.status === "queued" ? "queued" : job.status === "running" ? `${Math.round(job.progress * 100)}%` : "failed"}
        </span>
      </div>
      {active && <Progress value={job.progress} tone={job.status === "retrying" ? "amber" : "go"} className="mt-1" />}
      {job.errors.map((e) => (
        <p key={e.attempt} className="mt-1 text-amber-300">
          Attempt {e.attempt} failed: {e.message}
        </p>
      ))}
    </div>
  );
}
