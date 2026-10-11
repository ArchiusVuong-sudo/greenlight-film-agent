import { getDb } from "@/lib/db";
import { jsonError } from "@/lib/http";
import * as studio from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The project as JSON: plan, looks, clips and the cut with its export checks. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const db = getDb();
    const film = studio.getFilm(db, id);
    const project = {
      note: "Synthetic data. Every render is a procedural SVG labelled 'Simulated render'.",
      exportedAt: new Date().toISOString(),
      film,
      elements: studio.listElements(db, id),
      looks: studio.listLooks(db, id).map(({ assetId: _a, ...l }) => l),
      scenes: studio.listScenes(db, id),
      clips: studio.listJobs(db, id).filter((j) => j.kind === "clip" && j.status === "done").map((j) => ({ jobId: j.id, scene: j.target, seconds: j.seconds, resolution: j.resolution, model: j.model, credits: j.price, params: j.params })),
      cut: studio.getCut(db, id),
      exportChecks: studio.exportChecks(db, id),
    };
    const name = (film.title ?? film.id).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || film.id;
    return new Response(JSON.stringify(project, null, 2), {
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${name}.json"` },
    });
  } catch (e) {
    return jsonError(e);
  }
}
