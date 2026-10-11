import { getDb } from "@/lib/db";
import { jsonError, readJson } from "@/lib/http";
import { deliverInput } from "@/lib/runs";
import { appMode } from "@/lib/state";
import { answerDecision } from "@/lib/studio";
import { decisionAnswerSchema } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The director answers a card; the answer goes to the assistant as its next message. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string; decisionId: string }> }) {
  try {
    const { id, decisionId } = await ctx.params;
    const db = getDb();
    const answer = decisionAnswerSchema.parse(await readJson(req));
    const message = answerDecision(db, id, decisionId, answer);
    deliverInput(db, id, message, "director", appMode(db).mode);
    return Response.json({ ok: true, message });
  } catch (e) {
    return jsonError(e);
  }
}
