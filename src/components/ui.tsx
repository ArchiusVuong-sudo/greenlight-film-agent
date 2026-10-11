"use client";

import { Clapperboard } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type Tone = "neutral" | "go" | "amber" | "red" | "blue" | "violet";

const TONES: Record<Tone, string> = {
  neutral: "bg-ink-700/70 text-ink-200 ring-ink-600",
  go: "bg-go-500/12 text-go-400 ring-go-500/30",
  amber: "bg-amber-500/12 text-amber-300 ring-amber-500/30",
  red: "bg-red-500/12 text-red-300 ring-red-500/30",
  blue: "bg-sky-500/12 text-sky-300 ring-sky-500/30",
  violet: "bg-violet-500/12 text-violet-300 ring-violet-500/30",
};

export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", TONES[tone], className)}>
      {children}
    </span>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "amber";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-go-500 text-ink-950 hover:bg-go-400 shadow-[0_0_0_1px_rgb(34_197_94/0.4),0_6px_20px_-6px_rgb(34_197_94/0.6)]",
  secondary: "bg-ink-700 text-ink-100 hover:bg-ink-600 ring-1 ring-inset ring-ink-600",
  ghost: "text-ink-200 hover:bg-ink-700/70 hover:text-ink-100",
  danger: "bg-red-500/15 text-red-300 hover:bg-red-500/25 ring-1 ring-inset ring-red-500/30",
  amber: "bg-amber-400 text-ink-950 hover:bg-amber-300",
};

export function Button({ variant = "secondary", size = "md", className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "h-7 px-2.5 text-xs gap-1.5", md: "h-9 px-3.5 text-sm gap-2", lg: "h-11 px-5 text-[15px] gap-2" };
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-go-400/60",
        sizes[size],
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Progress({ value, tone = "go", className }: { value: number; tone?: "go" | "amber" | "red"; className?: string }) {
  const color = tone === "go" ? "bg-go-400" : tone === "amber" ? "bg-amber-400" : "bg-red-400";
  return (
    <div className={cx("h-1.5 w-full overflow-hidden rounded-full bg-ink-700", className)}>
      <div className={cx("h-full rounded-full transition-[width] duration-300", color)} style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-go-400 to-emerald-700 text-ink-950 shadow-[0_0_18px_-4px_rgb(74_222_128/0.7)]">
        <Clapperboard className="size-4" strokeWidth={2.4} />
      </div>
      {!compact && <span className="text-[15px] font-semibold tracking-tight">Greenlight</span>}
    </div>
  );
}

export function SyntheticPill() {
  return (
    <Badge tone="violet" title="Every brief, person, brand and render here is invented. Renders are procedural SVG.">
      Synthetic data
    </Badge>
  );
}

export function ModeBadge({ mode, model, reason }: { mode: "live" | "replay"; model?: string | null; reason?: string }) {
  if (mode === "replay")
    return (
      <Badge tone="amber" title={`Replay mode plays a recorded live run through the same tools. ${reason ?? ""}`}>
        <span className="size-1.5 rounded-full bg-amber-300" />
        Replay mode
      </Badge>
    );
  return (
    <Badge tone="go" title={reason}>
      <span className="size-1.5 rounded-full bg-go-400" />
      Live{model ? ` - ${model}` : ""}
    </Badge>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-300">{children}</h3>
      {right}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-600 px-6 py-10 text-center">
      {icon && <div className="mb-3 text-ink-400">{icon}</div>}
      <p className="text-sm font-medium text-ink-200">{title}</p>
      {children && <div className="mt-1 max-w-sm text-xs leading-relaxed text-ink-300">{children}</div>}
    </div>
  );
}

export function fmtSec(s: number): string {
  return `${Math.round(s * 10) / 10} s`;
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
