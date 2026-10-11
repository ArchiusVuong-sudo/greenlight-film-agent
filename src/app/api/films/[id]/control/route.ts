import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { getDb } from "@/lib/db";
import { jsonError, readJson } from "@/lib/http";
import { activeRun, deliverInput, setPaused, updateRun } from "@/lib/runs";
import { appMode } from "@/lib/state";
import { getFilm } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("continue") }),
  z.object({ action: z.literal("stop") }),
  z.object({ action: z.literal("message"), text: z.string().trim().min(1).max(1000) }),
]);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const db = getDb();
    getFilm(db, id);
    const b = body.parse(await readJson(req));
    const mode = appMode(db).mode;
    if (b.action === "pause") {
      if (!setPaused(db, id, true)) return Response.json({ error: "No active run to pause" }, { status: 409 });
    } else if (b.action === "continue") {
      deliverInput(db, id, "Continue.", "continue", mode);
    } else if (b.action === "message") {
      deliverInput(db, id, `Director: ${b.text}`, "instruction", mode);
    } else {
      const run = activeRun(db, id);
      if (run) {
        updateRun(db, run.id, { status: "stopped" });
        logActivity(db, { filmId: id, runId: run.id, kind: "director", name: "stop", status: "info", summary: "Director stopped the run" });
      }
    }
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
