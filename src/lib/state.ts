import { loadFixture } from "../agent/replay";
import { listActivity } from "./activity";
import { getMeta, type DB } from "./db";
import { cutLength } from "./exportChecks";
import { accountBalance, filmMoney, listLedger } from "./ledger";
import { activeRun, listRuns } from "./runs";
import * as studio from "./studio";

export type AppMode = "live" | "replay";

export function appMode(db: DB): { mode: AppMode; reason: string; workerAlive: boolean; model: string | null } {
  const beat = Number(getMeta(db, "worker_heartbeat") ?? 0);
  return {
    mode: (getMeta(db, "mode") as AppMode | null) ?? "replay",
    reason: getMeta(db, "mode_reason") ?? "",
    workerAlive: Date.now() - beat < 5000,
    model: getMeta(db, "model") || null,
  };
}

/** Everything the studio page shows, in one read. */
export function filmState(db: DB, filmId: string) {
  const film = studio.getFilm(db, filmId);
  const looks = studio.listLooks(db, filmId);
  const cut = studio.getCut(db, filmId);
  const app = appMode(db);
  return {
    film,
    app,
    replayHints: app.mode === "replay" ? replayHints(film.briefId) : [],
    scenes: studio.listScenes(db, filmId),
    elements: studio.listElements(db, filmId),
    looks,
    jobs: studio.listJobs(db, filmId),
    decisions: studio.listDecisions(db, filmId),
    planChecks: studio.planChecks(db, filmId),
    cut,
    cutLength: cut ? cutLength(cut) : 0,
    exportChecks: cut ? studio.exportChecks(db, filmId) : [],
    approvedLooks: studio.approvedLookVersions(db, filmId),
    money: filmMoney(db, filmId, film.budget),
    account: accountBalance(db),
    ledger: listLedger(db, filmId),
    shotCost: studio.shotCost(db, filmId),
    runs: listRuns(db, filmId),
    activeRun: activeRun(db, filmId) ?? null,
    activity: listActivity(db, filmId, 600),
  };
}

export type FilmState = ReturnType<typeof filmState>;

/** In replay mode: the director answers of the recorded run, so the cards can show what it chose. */
function replayHints(briefId: string | null): string[] {
  const f = loadFixture(briefId);
  return f ? f.segments.slice(1).map((s) => s.input) : [];
}
