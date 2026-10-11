import type { FilmSpec } from "./types";

export interface Brief extends FilmSpec {
  briefId: string;
  title: string;
  /** Eval expectation: the run must stop on a budget card. */
  expectBudgetStop?: boolean;
}

/** Synthetic briefs. No real brands, people or companies. */
export const DEFAULT_BRIEF: Brief = {
  briefId: "tea-flask",
  title: "Tea flask spec ad",
  brief:
    "A 20-second spec ad for an unbranded steel tea flask. Mara, a night-shift baker in a red raincoat, bikes through a rainy city before dawn and pours tea on a stone bridge at sunrise. Warm amber against blue night. One voice-over line at the end.",
  targetSec: 20,
  aspect: "9:16",
  resolution: "1080p",
  budget: 150,
  simulateTimeout: true,
};

export const EVAL_BRIEFS: Brief[] = [
  DEFAULT_BRIEF,
  {
    briefId: "last-dumpling",
    title: "The last dumpling",
    brief:
      "Two old friends, Ren and Odile, argue over the last dumpling at a night market stall. Fast, funny back-and-forth dialogue, and the stall owner settles it by splitting the dumpling in two.",
    targetSec: 20,
    aspect: "16:9",
    resolution: "720p",
    budget: 160,
    simulateTimeout: false,
  },
  {
    briefId: "mug-loop",
    title: "Ceramic mug loop",
    brief:
      "A seamless 1:1 product loop of a sage green ceramic mug on a kitchen table in soft morning light. Steam curls up, a hand turns the mug, the light moves across the glaze. No dialogue.",
    targetSec: 12,
    aspect: "1:1",
    resolution: "720p",
    budget: 100,
    simulateTimeout: false,
  },
  {
    briefId: "cliff-kite",
    title: "Kite on the cliff",
    brief:
      "A 30-second 16:9 short: a girl named Tove launches a red kite on a windy sea cliff, loses the string, and her grandfather catches it at the last second. One line of dialogue at most.",
    targetSec: 30,
    aspect: "16:9",
    resolution: "720p",
    budget: 220,
    simulateTimeout: false,
  },
  {
    briefId: "closing-time",
    title: "Closing time",
    brief:
      "A street musician, Ines, plays the last song of the evening in an emptying plaza at closing time, then packs up her accordion as shop shutters come down. One short spoken line to a passer-by.",
    targetSec: 20,
    aspect: "9:16",
    resolution: "720p",
    budget: 150,
    simulateTimeout: false,
  },
  {
    briefId: "tiny-chase",
    title: "Rooftop chase on 20 credits",
    brief:
      "A 20-second 1080p rooftop chase at night: a courier named Juno sprints across wet rooftops, leaps a gap and lands on a fire escape. Keep it at 1080p.",
    targetSec: 20,
    aspect: "16:9",
    resolution: "1080p",
    budget: 20,
    simulateTimeout: false,
    expectBudgetStop: true,
  },
];

export function findBrief(briefId: string | null | undefined): Brief | undefined {
  return EVAL_BRIEFS.find((b) => b.briefId === briefId);
}
