import type { DB } from "./db";

export type LedgerKind = "grant" | "hold" | "charge" | "release";

export interface LedgerRow {
  id: number;
  filmId: string | null;
  kind: LedgerKind;
  amount: number;
  jobId: string | null;
  quoteId: string | null;
  note: string;
  createdAt: number;
}

export interface FilmMoney {
  budget: number;
  spent: number;
  held: number;
  committed: number;
  remaining: number;
}

/**
 * Holds reserve credits when a job is queued. A hold turns into a charge of the same amount
 * when the job succeeds and is released when it finally fails, so held = holds - charges - releases.
 */
export function addEntry(db: DB, row: Omit<LedgerRow, "id" | "createdAt">): void {
  db.prepare("INSERT INTO ledger (film_id, kind, amount, job_id, quote_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    row.filmId,
    row.kind,
    row.amount,
    row.jobId,
    row.quoteId,
    row.note,
    Date.now(),
  );
}

function sums(db: DB, filmId: string | null): Record<LedgerKind, number> {
  const rows = (
    filmId === null
      ? db.prepare("SELECT kind, SUM(amount) AS total FROM ledger GROUP BY kind").all()
      : db.prepare("SELECT kind, SUM(amount) AS total FROM ledger WHERE film_id = ? GROUP BY kind").all(filmId)
  ) as { kind: LedgerKind; total: number }[];
  const out: Record<LedgerKind, number> = { grant: 0, hold: 0, charge: 0, release: 0 };
  for (const r of rows) out[r.kind] = r.total ?? 0;
  return out;
}

export function filmMoney(db: DB, filmId: string, budget: number): FilmMoney {
  const s = sums(db, filmId);
  const held = s.hold - s.charge - s.release;
  const committed = s.charge + held;
  return { budget, spent: s.charge, held, committed, remaining: budget - committed };
}

/** Demo account balance across all films: grant minus charges minus open holds. */
export function accountBalance(db: DB): { granted: number; available: number } {
  const s = sums(db, null);
  const held = s.hold - s.charge - s.release;
  return { granted: s.grant, available: s.grant - s.charge - held };
}

export function listLedger(db: DB, filmId: string): LedgerRow[] {
  const rows = db
    .prepare("SELECT * FROM ledger WHERE film_id = ? OR film_id IS NULL ORDER BY id")
    .all(filmId) as { id: number; film_id: string | null; kind: LedgerKind; amount: number; job_id: string | null; quote_id: string | null; note: string; created_at: number }[];
  return rows.map((r) => ({ id: r.id, filmId: r.film_id, kind: r.kind, amount: r.amount, jobId: r.job_id, quoteId: r.quote_id, note: r.note, createdAt: r.created_at }));
}

export interface UsableShotCost {
  spent: number;
  usableShots: number;
  rejectedCredits: number;
  /** null when there are no usable shots yet (never a misleading 0). */
  perShot: number | null;
}

export function costPerUsableShot(spent: number, usableShots: number, rejectedCredits: number): UsableShotCost {
  return { spent, usableShots, rejectedCredits, perShot: usableShots > 0 ? Math.round((spent / usableShots) * 10) / 10 : null };
}
