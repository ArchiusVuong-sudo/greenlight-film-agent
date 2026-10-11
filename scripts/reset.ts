/** Deletes the local SQLite file so the next start begins with a fresh demo balance. */
import { rmSync } from "node:fs";
import { dbPath } from "../src/lib/db";

const p = dbPath();
for (const suffix of ["", "-wal", "-shm"]) rmSync(p + suffix, { force: true });
console.log(`Removed ${p}`);
