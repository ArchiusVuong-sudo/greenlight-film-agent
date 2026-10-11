import { getDb } from "@/lib/db";
import { jsonError, readJson } from "@/lib/http";
import { createRun } from "@/lib/runs";
import { appMode } from "@/lib/state";
import { createFilm, listFilms } from "@/lib/studio";
import { filmSpecSchema } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const db = getDb();
  return Response.json({ films: listFilms(db), app: appMode(db) });
}

/** New film: saves the spec and queues a run; the worker picks it up. */
export async function POST(req: Request) {
  try {
    const db = getDb();
    const spec = filmSpecSchema.parse(await readJson(req));
    const film = createFilm(db, spec);
    createRun(db, film.id, appMode(db).mode);
    return Response.json({ id: film.id }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
