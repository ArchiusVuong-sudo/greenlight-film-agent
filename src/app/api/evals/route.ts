import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The last `npm run eval` report, or null when there is none yet. */
export function GET() {
  const p = resolve("evals/report.json");
  if (!existsSync(p)) return Response.json({ report: null });
  try {
    return Response.json({ report: JSON.parse(readFileSync(p, "utf8")) });
  } catch {
    return Response.json({ report: null, error: "The report file could not be read" });
  }
}
