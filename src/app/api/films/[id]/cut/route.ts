import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { getDb } from "@/lib/db";
import { jsonError, readJson } from "@/lib/http";
import { assembleCut, trimCut } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assemble") }),
  z.object({ action: z.literal("trim"), scene: z.number().int(), in: z.number().min(0), out: z.number().min(0) }),
]);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const db = getDb();
    const b = body.parse(await readJson(req));
    if (b.action === "assemble") {
      const res = assembleCut(db, id);
      logActivity(db, { filmId: id, kind: "director", name: "assemble", status: "info", summary: `Director assembled the cut (${res.cut.length} clips)` });
    } else {
      trimCut(db, id, b.scene, b.in, b.out);
    }
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
