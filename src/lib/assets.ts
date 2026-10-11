import { randomBytes } from "node:crypto";
import { primaryColor } from "./colors";
import { json, type DB } from "./db";
import type { RenderElement } from "./render/svg";
import type { ElementRow } from "./types";

export const DEFAULT_PALETTE = ["#1b2a4a", "#f0a43a", "#c2563a"];

export function saveAsset(db: DB, filmId: string | null, kind: string, svg: string, meta: Record<string, unknown>): string {
  const id = `a-${randomBytes(6).toString("hex")}`;
  db.prepare("INSERT INTO assets (id, film_id, kind, svg, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, filmId, kind, svg, JSON.stringify(meta), Date.now());
  return id;
}

export function getAsset(db: DB, id: string): { id: string; kind: string; svg: string; meta: Record<string, unknown> } | undefined {
  const r = db.prepare("SELECT id, kind, svg, meta FROM assets WHERE id = ?").get(id) as { id: string; kind: string; svg: string; meta: string } | undefined;
  return r ? { ...r, meta: json(r.meta, {}) } : undefined;
}

/** Element plus the colour its look should use (a redo note wins over the description). */
export function toRenderElement(el: ElementRow, version: number, note: string | null): RenderElement {
  return { id: el.id, kind: el.kind, name: el.name, description: note ? `${el.description}. ${note}` : el.description, color: primaryColor(el.description, note), version };
}
