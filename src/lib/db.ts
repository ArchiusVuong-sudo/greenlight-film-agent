import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { LIBRARY } from "./library";

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS films (
  id TEXT PRIMARY KEY,
  brief_id TEXT,
  brief TEXT NOT NULL,
  target_sec REAL NOT NULL,
  aspect TEXT NOT NULL,
  resolution TEXT NOT NULL,
  budget INTEGER NOT NULL,
  simulate_timeout INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  logline TEXT,
  look TEXT,
  checks TEXT,
  cut TEXT,
  seq INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scenes (
  film_id TEXT NOT NULL,
  n INTEGER NOT NULL,
  heading TEXT NOT NULL,
  action TEXT NOT NULL,
  dialogue TEXT NOT NULL,
  duration_sec REAL NOT NULL,
  element_ids TEXT NOT NULL,
  camera_move TEXT NOT NULL DEFAULT 'push-in',
  PRIMARY KEY (film_id, n)
);

CREATE TABLE IF NOT EXISTS elements (
  film_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (film_id, id)
);

CREATE TABLE IF NOT EXISTS looks (
  film_id TEXT NOT NULL,
  element_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  asset_id TEXT,
  job_id TEXT,
  note TEXT,
  credits INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (film_id, element_id, version)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT NOT NULL,
  film_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  idem_key TEXT NOT NULL,
  model TEXT NOT NULL,
  resolution TEXT,
  seconds REAL,
  ref_inputs INTEGER NOT NULL DEFAULT 0,
  price INTEGER NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  progress REAL NOT NULL DEFAULT 0,
  fail_first INTEGER NOT NULL DEFAULT 0,
  errors TEXT NOT NULL DEFAULT '[]',
  params TEXT NOT NULL DEFAULT '{}',
  asset_id TEXT,
  quote_id TEXT,
  run_id TEXT,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  PRIMARY KEY (film_id, id),
  UNIQUE (film_id, idem_key)
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  film_id TEXT,
  kind TEXT NOT NULL,
  svg TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  film_id TEXT,
  kind TEXT NOT NULL,
  amount INTEGER NOT NULL,
  job_id TEXT,
  quote_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS quotes (
  id TEXT NOT NULL,
  film_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  request TEXT NOT NULL,
  lines TEXT NOT NULL,
  total INTEGER NOT NULL,
  status TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (film_id, id)
);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT NOT NULL,
  film_id TEXT NOT NULL,
  run_id TEXT,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  answer TEXT,
  opened_by TEXT NOT NULL DEFAULT 'assistant',
  created_at INTEGER NOT NULL,
  answered_at INTEGER,
  PRIMARY KEY (film_id, id)
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  film_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0,
  session_id TEXT,
  turns INTEGER NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  tokens_cache INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  error TEXT,
  record_to TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);

CREATE TABLE IF NOT EXISTS run_inputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  text TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  film_id TEXT NOT NULL,
  run_id TEXT,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  credits INTEGER,
  tokens_in INTEGER,
  tokens_out INTEGER,
  summary TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS activity_film ON activity (film_id, id);

CREATE TABLE IF NOT EXISTS library (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  tags TEXT NOT NULL,
  description TEXT NOT NULL
);
`;

export const DEMO_GRANT = 1000;

let shared: DB | null = null;

export function dbPath(): string {
  return resolve(/*turbopackIgnore: true*/ process.env.GREENLIGHT_DB || "data/greenlight.db");
}

/** Opens (and migrates) a SQLite file. WAL plus busy_timeout lets the web app and the worker share it. */
export function openDb(path: string = dbPath()): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  seed(db);
  return db;
}

/** One connection per process. */
export function getDb(): DB {
  if (!shared) shared = openDb();
  return shared;
}

function seed(db: DB): void {
  const has = db.prepare("SELECT value FROM meta WHERE key = 'seeded'").get();
  if (has) return;
  const tx = db.transaction(() => {
    const ins = db.prepare("INSERT OR IGNORE INTO library (id, kind, name, tags, description) VALUES (?, ?, ?, ?, ?)");
    for (const item of LIBRARY) ins.run(item.id, item.kind, item.name, item.tags.join(","), item.description);
    db.prepare("INSERT INTO ledger (film_id, kind, amount, note, created_at) VALUES (NULL, 'grant', ?, 'Demo balance (synthetic credits)', ?)").run(DEMO_GRANT, Date.now());
    db.prepare("INSERT INTO meta (key, value) VALUES ('seeded', '1')").run();
  });
  tx();
}

export function getMeta(db: DB, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(db: DB, key: string, value: string): void {
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

/** Per-film counter for ids the model sees (Q1, D2, J7). Sequential ids keep replays deterministic. */
export function nextId(db: DB, filmId: string, prefix: string): string {
  db.prepare("UPDATE films SET seq = seq + 1 WHERE id = ?").run(filmId);
  const row = db.prepare("SELECT seq FROM films WHERE id = ?").get(filmId) as { seq: number } | undefined;
  if (!row) throw new Error(`Unknown film ${filmId}`);
  return `${prefix}${row.seq}`;
}

export function json<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
