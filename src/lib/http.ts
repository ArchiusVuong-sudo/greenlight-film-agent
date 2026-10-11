import { ZodError } from "zod";
import { StudioError } from "./studio";

export function jsonError(e: unknown): Response {
  if (e instanceof ZodError) {
    return Response.json({ error: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") }, { status: 400 });
  }
  if (e instanceof StudioError) return Response.json({ error: e.message }, { status: 409 });
  const message = e instanceof Error ? e.message : String(e);
  console.error(e);
  return Response.json({ error: message }, { status: 500 });
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
