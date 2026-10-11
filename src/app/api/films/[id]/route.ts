import { getDb } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { filmState } from "@/lib/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return Response.json(filmState(getDb(), id));
  } catch (e) {
    return jsonError(e);
  }
}
