"use client";

import { Activity, Bot, Loader2, Send, Sparkles, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FilmState } from "@/lib/state";
import { Button, cx } from "../ui";
import { ActivityView } from "./ActivityView";
import { DecisionCard } from "./DecisionCard";
import { post } from "./Studio";

type Feed = { id: number; who: "assistant" | "director" | "system"; text: string; tone?: "error" | "info" };

export function AssistantPanel({ state, filmId, refresh }: { state: FilmState; filmId: string; refresh: () => Promise<void> }) {
  const [view, setView] = useState<"assistant" | "activity">("assistant");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const open = state.decisions.filter((d) => d.status === "open");

  const feed: Feed[] = [];
  for (const a of state.activity) {
    if (a.kind === "turn") {
      const t = ((a.detail as { text?: string } | null)?.text ?? "").trim();
      if (t) feed.push({ id: a.id, who: "assistant", text: plain(t) });
    } else if (a.kind === "director" && a.name !== "pause" && a.name !== "resume") {
      feed.push({ id: a.id, who: "director", text: a.summary.replace(/^Director: /, "") });
    } else if (a.kind === "system" && (a.status === "error" || a.name === "server card")) {
      feed.push({ id: a.id, who: "system", text: a.summary, tone: a.status === "error" ? "error" : "info" });
    }
  }
  const working = state.activeRun?.status === "running" || state.activeRun?.status === "queued";
  const lastTool = [...state.activity].reverse().find((a) => a.kind === "tool");

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [feed.length, open.length]);

  async function send() {
    if (!text.trim()) return;
    setSending(true);
    await post(`/api/films/${filmId}/control`, { action: "message", text });
    setText("");
    setSending(false);
    await refresh();
  }

  return (
    <aside className="flex min-h-0 flex-col border-l border-ink-700/80 bg-ink-900/60">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-ink-700/80 px-3">
        <TabBtn active={view === "assistant"} onClick={() => setView("assistant")} icon={<Sparkles className="size-4" />} label="Assistant" badge={open.length || undefined} />
        <TabBtn active={view === "activity"} onClick={() => setView("activity")} icon={<Activity className="size-4" />} label="Activity" />
        <span className="ml-auto text-[11px] text-ink-400">{state.runs.length} run{state.runs.length === 1 ? "" : "s"}</span>
      </div>

      {view === "activity" ? (
        <ActivityView state={state} />
      ) : (
        <>
          <div ref={scroller} className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {feed.length === 0 && !working && <p className="px-2 py-8 text-center text-xs text-ink-400">The assistant has not said anything yet.</p>}
            {feed.map((f) => (
              <Bubble key={f.id} f={f} />
            ))}
            {working && (
              <div className="flex items-center gap-2 px-1 text-xs text-ink-300">
                <Loader2 className="size-3.5 animate-spin text-sky-300" />
                {lastTool ? `Working: ${lastTool.name}` : "Reading the brief"}
              </div>
            )}
            {open.map((d) => (
              <DecisionCard key={d.id} state={state} d={d} filmId={filmId} refresh={refresh} />
            ))}
          </div>
          <div className="shrink-0 border-t border-ink-700/80 p-3">
            <div className="flex items-end gap-2 rounded-xl border border-ink-600 bg-ink-850 p-1.5 focus-within:border-go-500/50">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                placeholder="Tell the assistant what to change"
                className="max-h-28 min-h-[34px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-ink-400"
                aria-label="Instruction for the assistant"
              />
              <Button size="sm" variant="primary" onClick={send} disabled={sending || !text.trim()} aria-label="Send">
                <Send className="size-3.5" />
              </Button>
            </div>
            <p className="mt-1.5 px-1 text-[10px] text-ink-400">Goes to the assistant as its next message. Pause stops it at the next tool call.</p>
          </div>
        </>
      )}
    </aside>
  );
}

function TabBtn({ active, onClick, icon, label, badge }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: number }) {
  return (
    <button onClick={onClick} className={cx("flex h-8 items-center gap-2 rounded-lg px-3 text-sm transition", active ? "bg-ink-700 text-ink-100" : "text-ink-300 hover:bg-ink-800 hover:text-ink-100")}>
      {icon}
      {label}
      {badge ? <span className="grid size-4 place-items-center rounded-full bg-amber-400 text-[10px] font-bold text-ink-950">{badge}</span> : null}
    </button>
  );
}

function Bubble({ f }: { f: Feed }) {
  if (f.who === "system")
    return <p className={cx("rounded-lg px-3 py-2 text-[11px]", f.tone === "error" ? "bg-red-500/10 text-red-300" : "bg-ink-800 text-ink-300")}>{f.text}</p>;
  const mine = f.who === "director";
  return (
    <div className={cx("fade-up flex gap-2", mine && "flex-row-reverse")}>
      <div className={cx("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full", mine ? "bg-ink-600 text-ink-100" : "bg-go-500/15 text-go-400")}>
        {mine ? <UserRound className="size-3.5" /> : <Bot className="size-3.5" />}
      </div>
      <div className={cx("max-w-[86%] whitespace-pre-wrap rounded-xl px-3 py-2 text-[13px] leading-relaxed", mine ? "bg-ink-700 text-ink-100" : "bg-ink-850 text-ink-100 ring-1 ring-ink-700")}>{f.text}</div>
    </div>
  );
}

/** Model text is shown as plain text; strip the few markdown marks it may still use. */
function plain(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "").replace(/`([^`]+)`/g, "$1");
}
