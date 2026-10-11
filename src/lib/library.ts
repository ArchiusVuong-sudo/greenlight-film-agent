import type { ElementKind } from "./types";

export interface LibraryItem {
  id: string;
  kind: ElementKind;
  name: string;
  tags: string[];
  description: string;
}

/** Previously approved references (synthetic). Reusing one costs 0 credits. */
export const LIBRARY: LibraryItem[] = [
  { id: "LIB-01", kind: "location", name: "Rainy city street at night", tags: ["street", "city", "rain", "night", "wet", "neon", "urban", "road"], description: "Wet asphalt, shuttered shops, sodium street lamps, rain streaks, blue night" },
  { id: "LIB-02", kind: "location", name: "Bakery doorway before dawn", tags: ["bakery", "doorway", "shop", "bread", "dawn", "warm", "kitchen"], description: "A lit bakery door, flour on the step, warm amber light spilling onto a dark pavement" },
  { id: "LIB-03", kind: "location", name: "Stone bridge at dawn", tags: ["bridge", "stone", "river", "dawn", "sunrise", "water", "arch"], description: "An old stone arch bridge over a calm river, first sun on the parapet" },
  { id: "LIB-04", kind: "location", name: "Night market stalls", tags: ["market", "night", "stalls", "lanterns", "food", "street"], description: "Rows of food stalls under paper lanterns, steam rising from pots" },
  { id: "LIB-05", kind: "location", name: "Windy sea cliff", tags: ["cliff", "sea", "wind", "grass", "coast", "ocean"], description: "A grassy cliff edge over a grey sea, long grass bent by the wind" },
  { id: "LIB-06", kind: "location", name: "Sunlit kitchen table", tags: ["kitchen", "table", "morning", "sunlight", "home", "window"], description: "A wooden table by a window, soft morning light, linen cloth" },
  { id: "LIB-07", kind: "location", name: "Shuttered plaza at closing time", tags: ["plaza", "square", "evening", "closing", "street", "busker"], description: "A small square at dusk, shop shutters coming down, one lamp post" },
  { id: "LIB-08", kind: "prop", name: "Plain enamel cup", tags: ["cup", "enamel", "mug", "drink"], description: "A plain white enamel cup with a dark rim" },
];
