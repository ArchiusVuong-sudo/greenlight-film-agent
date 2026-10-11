import type { DB } from "../lib/db";
import { filmMoney } from "../lib/ledger";
import { getFilm, listDecisions, listElements } from "../lib/studio";
import type { Decision, DecisionAnswer } from "../lib/types";
import type { AutoDirector } from "./runner";

const MAX_BUDGET_ANSWERS = 3;

/**
 * Budget card: the option that keeps the most of the brief while fitting what is left of the budget.
 * Never approves spending over the budget; no fitting option leaves the card open.
 */
export function pickBudgetOption(db: DB, filmId: string, d: Decision): DecisionAnswer | null {
  const film = getFilm(db, filmId);
  const answered = listDecisions(db, filmId).filter((x) => x.kind === "budget" && x.status === "answered").length;
  if (answered >= MAX_BUDGET_ANSWERS) return null;
  const left = filmMoney(db, filmId, film.budget).remaining;
  const options = (d.payload.options ?? []).filter((o) => o.id !== "approve-quote" && o.id !== "replan");
  const fitting = options.filter((o) => typeof o.estimateCredits === "number" && o.estimateCredits <= left);
  fitting.sort((a, b) => (b.estimateCredits ?? 0) - (a.estimateCredits ?? 0));
  const pick = fitting[0];
  return pick ? { kind: "option", optionId: pick.id } : null;
}

/** Evals: approve every look, pick a fitting budget option, take the first answer to a question. */
export const evalDirector: AutoDirector = (db, filmId, d) => {
  if (d.kind === "look") return { kind: "look", looks: (d.payload.elementIds ?? []).map((id) => ({ elementId: id, verdict: "approve" as const })) };
  if (d.kind === "budget") return pickBudgetOption(db, filmId, d);
  const first = d.payload.options?.[0];
  return first ? { kind: "option", optionId: first.id } : null;
};

export const REDO_NOTE = "yellow raincoat, not red";

/** The recorded demo: like the eval director, but the first look card sends the lead cast member back once. */
export const demoDirector: AutoDirector = (db, filmId, d) => {
  if (d.kind === "look") {
    const lead = listElements(db, filmId).find((e) => e.kind === "cast")?.id;
    const firstLookCard = listDecisions(db, filmId).filter((x) => x.kind === "look" && x.status === "answered").length === 0;
    return {
      kind: "look",
      looks: (d.payload.elementIds ?? []).map((id) =>
        firstLookCard && id === lead ? { elementId: id, verdict: "redo" as const, note: REDO_NOTE } : { elementId: id, verdict: "approve" as const },
      ),
    };
  }
  if (d.kind === "budget") {
    // The demo takes the all-720p option when the assistant offers one that fits.
    const left = filmMoney(db, filmId, getFilm(db, filmId).budget).remaining;
    const all720 = (d.payload.options ?? []).find((o) => /720p/i.test(o.label) && !/1080p/i.test(o.label) && (o.estimateCredits ?? Infinity) <= left);
    if (all720) return { kind: "option", optionId: all720.id };
  }
  return evalDirector(db, filmId, d);
};
