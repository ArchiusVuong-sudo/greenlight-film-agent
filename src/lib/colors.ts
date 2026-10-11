/** Colour words the procedural renderer understands. */
export const COLOR_WORDS: Record<string, string> = {
  red: "#d6453d",
  crimson: "#b3203a",
  scarlet: "#e0362c",
  orange: "#ea7a2a",
  amber: "#f0a43a",
  gold: "#e3b341",
  golden: "#e3b341",
  yellow: "#f2cf3b",
  mustard: "#d1a72b",
  green: "#4f9a5a",
  olive: "#7d8a3a",
  teal: "#2f8f8a",
  turquoise: "#3cb6b0",
  blue: "#3f6fd1",
  navy: "#22335e",
  cobalt: "#2c55b8",
  indigo: "#4b3f9e",
  purple: "#7b4bb0",
  violet: "#8a5cd1",
  lilac: "#b59ad8",
  pink: "#e57aa8",
  magenta: "#c23d93",
  brown: "#7a5236",
  tan: "#c49a6c",
  beige: "#d9c7a5",
  cream: "#efe4c8",
  white: "#f2f0ea",
  ivory: "#f1ead8",
  grey: "#8a8f98",
  gray: "#8a8f98",
  silver: "#b9bec6",
  charcoal: "#3a3d43",
  black: "#1d1e22",
  copper: "#b8693a",
  bronze: "#9c7340",
  rust: "#a4492b",
};

const NEGATIONS = new Set(["not", "no", "never", "without"]);
const NEGATION_PHRASES = ["instead of", "rather than"];

/**
 * Colour words in reading order, skipping negated ones:
 * "yellow raincoat, not red" gives ["yellow"].
 */
export function extractColors(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (!(w in COLOR_WORDS)) continue;
    const prev1 = words[i - 1] ?? "";
    const prev2 = words[i - 2] ?? "";
    const prevPair = `${prev2} ${prev1}`;
    if (NEGATIONS.has(prev1) || NEGATIONS.has(prev2) || NEGATION_PHRASES.includes(prevPair)) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

/** The main colour for an element: a redo note wins over the description. */
export function primaryColor(description: string, note?: string | null): string | null {
  const fromNote = note ? extractColors(note) : [];
  const word = fromNote[0] ?? extractColors(description)[0];
  return word ? COLOR_WORDS[word]! : null;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear mix of two hex colours, t = 0 gives a, t = 1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}
