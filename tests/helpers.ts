import { DEFAULT_BRIEF, type Brief } from "../src/lib/briefs";
import { openDb, type DB } from "../src/lib/db";
import { createFilm, setProject, upsertElements, writeScenes } from "../src/lib/studio";
import type { ElementInput, SceneInput } from "../src/lib/types";

export function freshDb(): DB {
  return openDb(":memory:");
}

export const ELEMENTS: ElementInput[] = [
  { id: "baker", kind: "cast", name: "Mara", description: "Night-shift baker in a red raincoat" },
  { id: "flask", kind: "prop", name: "Steel flask", description: "Unbranded brushed steel tea flask" },
  { id: "street", kind: "location", name: "Rainy street", description: "Wet city street before dawn" },
  { id: "bridge", kind: "location", name: "Stone bridge", description: "Old stone bridge at sunrise" },
];

export const SCENES: SceneInput[] = [
  { n: 1, heading: "EXT. RAINY STREET - NIGHT", action: "Mara cycles through the rain, the flask in her basket.", dialogue: [], durationSec: 6, elementIds: ["baker", "flask", "street"] },
  { n: 2, heading: "EXT. STONE BRIDGE - DAWN", action: "She stops on the bridge and pours tea. Steam rises.", dialogue: [], durationSec: 7, elementIds: ["baker", "flask", "bridge"] },
  { n: 3, heading: "EXT. STONE BRIDGE - SUNRISE", action: "The sun clears the roofs. She drinks.", dialogue: [{ speaker: "baker", line: "First light, first cup.", vo: true }], durationSec: 7, elementIds: ["baker", "bridge"] },
];

export function filmWithPlan(db: DB, brief: Partial<Brief> = {}): string {
  const film = createFilm(db, { ...DEFAULT_BRIEF, ...brief });
  setProject(db, film.id, { title: "First Light", logline: "A baker's quiet pour at dawn.", look: { palette: ["#14213d", "#f0a43a", "#a83232"], style: "Soft night light", mood: "Calm" } });
  upsertElements(db, film.id, ELEMENTS);
  writeScenes(db, film.id, SCENES);
  return film.id;
}
