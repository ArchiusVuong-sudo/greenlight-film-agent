import { mix } from "../colors";
import type { Aspect, ElementKind } from "../types";

/** Procedural SVG renders. Every image is stamped "Simulated render"; nothing comes from an image model. */

export interface RenderElement {
  id: string;
  kind: ElementKind;
  name: string;
  description: string;
  color: string | null;
  version: number;
}

export interface FrameInput {
  aspect: Aspect;
  palette: string[];
  heading: string;
  sceneN: number;
  elements: RenderElement[];
}

const SIZES: Record<Aspect, [number, number]> = { "9:16": [540, 960], "16:9": [960, 540], "1:1": [720, 720] };

export function sizeFor(aspect: Aspect): [number, number] {
  return SIZES[aspect];
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const has = (text: string, words: string[]) => words.some((w) => new RegExp(`\\b${w}`, "i").test(text));

type TimeOfDay = "night" | "dawn" | "day" | "dusk";

export function timeOfDay(heading: string): TimeOfDay {
  const h = heading.toUpperCase();
  if (/(DAWN|SUNRISE|PRE-DAWN|FIRST LIGHT)/.test(h)) return "dawn";
  if (/(DUSK|SUNSET|EVENING|CLOSING)/.test(h)) return "dusk";
  if (/(NIGHT|MIDNIGHT|LATE)/.test(h)) return "night";
  return "day";
}

function sky(tod: TimeOfDay, palette: string[]): [string, string] {
  const p0 = palette[0] ?? "#1b2a4a";
  const p1 = palette[1] ?? "#f0a43a";
  switch (tod) {
    case "night":
      return [mix("#070b18", p0, 0.35), mix("#1a2747", p0, 0.4)];
    case "dawn":
      return [mix("#1c2b52", p0, 0.3), mix("#f2a65a", p1, 0.45)];
    case "dusk":
      return [mix("#2b2350", p0, 0.3), mix("#e88a5a", p1, 0.4)];
    default:
      return [mix("#8fc0e8", p0, 0.15), mix("#e8f1f6", p1, 0.15)];
  }
}

function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function stamp(w: number, label: string): string {
  const k = Math.max(1, w / 420);
  return `<g transform="scale(${k})">${stampAt(w / k, label)}</g>`;
}

function stampAt(w: number, label: string): string {
  const pill = `<g font-family="Helvetica, Arial, sans-serif" font-weight="700">
    <rect x="16" y="16" rx="10" width="168" height="28" fill="#000" fill-opacity="0.55"/>
    <circle cx="32" cy="30" r="5" fill="#ff5a4e"/>
    <text x="44" y="35" font-size="14" fill="#fff" letter-spacing="1">SIMULATED RENDER</text>
  </g>`;
  const tag = label
    ? `<g font-family="Helvetica, Arial, sans-serif"><rect x="${w - 16 - label.length * 8 - 20}" y="16" rx="10" width="${label.length * 8 + 20}" height="28" fill="#000" fill-opacity="0.45"/>
    <text x="${w - 26}" y="35" text-anchor="end" font-size="14" fill="#fff">${esc(label)}</text></g>`
    : "";
  return pill + tag;
}

type LocationType = "bridge" | "coast" | "market" | "interior" | "shopfront" | "plaza" | "street";

const LOCATION_WORDS: [LocationType, string[]][] = [
  ["bridge", ["bridge"]],
  ["coast", ["cliff", "sea", "coast", "ocean", "shore", "beach"]],
  ["market", ["market", "stall", "stalls", "lantern"]],
  ["plaza", ["plaza", "square", "busker"]],
  ["shopfront", ["bakery", "doorway", "door", "shop", "cafe"]],
  ["street", ["street", "city", "road", "alley", "rooftop", "roof", "avenue"]],
  ["interior", ["kitchen", "table", "home", "room", "studio", "window", "apartment"]],
];

/** The element name decides first; the description only breaks a tie. */
export function locationType(el: { name: string; description: string } | undefined): LocationType {
  if (!el) return "street";
  for (const text of [el.name, el.description]) {
    for (const [type, words] of LOCATION_WORDS) if (has(text, words)) return type;
  }
  return "street";
}

function location(el: RenderElement | undefined, w: number, h: number, tod: TimeOfDay, palette: string[], r: () => number): string {
  const type = locationType(el);
  const ground = h * 0.72;
  const accent = el?.color ?? palette[1] ?? "#f0a43a";
  const lit = tod === "night" || tod === "dawn" || tod === "dusk";
  const out: string[] = [];
  const dark = mix("#0b0f1c", palette[0] ?? "#1b2a4a", 0.3);

  if (type === "bridge") {
    const water = ground + h * 0.05;
    out.push(`<rect x="0" y="${water}" width="${w}" height="${h - water}" fill="${mix(dark, "#3d5a80", 0.5)}"/>`);
    for (let i = 0; i < 14; i++) out.push(`<rect x="${r() * w}" y="${water + 10 + r() * (h - water - 20)}" width="${20 + r() * 60}" height="2" fill="${accent}" opacity="${0.15 + r() * 0.3}"/>`);
    const deck = ground - h * 0.06;
    out.push(`<path d="M0 ${deck} L${w} ${deck} L${w} ${deck + 26} L0 ${deck + 26} Z" fill="${mix(dark, "#6b6f78", 0.6)}"/>`);
    const arches = Math.max(2, Math.round(w / 260));
    for (let i = 0; i < arches; i++) {
      const x0 = (i * w) / arches;
      const x1 = ((i + 1) * w) / arches;
      out.push(`<path d="M${x0} ${deck + 26} Q${(x0 + x1) / 2} ${water + 10} ${x1} ${deck + 26} L${x1} ${water} L${x0} ${water} Z" fill="${mix(dark, "#55595f", 0.55)}"/>`);
      out.push(`<path d="M${x0 + 24} ${water} Q${(x0 + x1) / 2} ${deck + 70} ${x1 - 24} ${water} Z" fill="${mix(dark, "#3d5a80", 0.4)}"/>`);
    }
    out.push(`<rect x="0" y="${deck - 18}" width="${w}" height="18" fill="${mix(dark, "#80848c", 0.6)}"/>`);
    return out.join("");
  }

  if (type === "coast") {
    out.push(`<rect x="0" y="${h * 0.55}" width="${w}" height="${h * 0.45}" fill="${mix("#2f4a63", palette[0] ?? "#2f4a63", 0.3)}"/>`);
    out.push(`<path d="M0 ${h * 0.62} L${w * 0.62} ${h * 0.6} L${w * 0.7} ${h * 0.68} L${w * 0.66} ${h} L0 ${h} Z" fill="${mix("#3f6b3a", accent, 0.15)}"/>`);
    for (let i = 0; i < 40; i++) {
      const x = r() * w * 0.62;
      const y = h * 0.61 + r() * h * 0.05;
      out.push(`<path d="M${x} ${y} q8 -18 22 -26" stroke="${mix("#9fc27a", accent, 0.2)}" stroke-width="2" fill="none" opacity="0.7"/>`);
    }
    return out.join("");
  }

  if (type === "market") {
    out.push(`<rect x="0" y="${ground}" width="${w}" height="${h - ground}" fill="${mix(dark, "#3a2f2a", 0.6)}"/>`);
    const n = Math.max(3, Math.round(w / 180));
    for (let i = 0; i < n; i++) {
      const x = (i * w) / n + 10;
      const sw = w / n - 20;
      out.push(`<rect x="${x}" y="${ground - h * 0.2}" width="${sw}" height="${h * 0.2}" fill="${mix(dark, "#4a3a30", 0.7)}"/>`);
      out.push(`<path d="M${x - 6} ${ground - h * 0.2} L${x + sw / 2} ${ground - h * 0.28} L${x + sw + 6} ${ground - h * 0.2} Z" fill="${i % 2 ? "#b8453a" : mix(accent, "#b8453a", 0.4)}"/>`);
      out.push(`<rect x="${x + 8}" y="${ground - h * 0.12}" width="${sw - 16}" height="${h * 0.05}" fill="${accent}" opacity="0.55"/>`);
    }
    for (let i = 0; i < 16; i++) {
      const x = r() * w;
      const y = h * 0.18 + r() * h * 0.22;
      out.push(`<line x1="${x}" y1="0" x2="${x}" y2="${y - 14}" stroke="#000" stroke-opacity="0.4"/><circle cx="${x}" cy="${y}" r="${10 + r() * 8}" fill="${i % 3 ? "#f0a43a" : "#e0623a"}" opacity="0.9"/>`);
    }
    return out.join("");
  }

  if (type === "interior") {
    out.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="${mix("#e9e1d3", palette[0] ?? "#e9e1d3", 0.15)}"/>`);
    out.push(`<rect x="${w * 0.12}" y="${h * 0.12}" width="${w * 0.42}" height="${h * 0.34}" rx="6" fill="${mix("#fff6dd", accent, 0.2)}" stroke="${mix("#c9b79c", "#000", 0.1)}" stroke-width="10"/>`);
    out.push(`<line x1="${w * 0.33}" y1="${h * 0.12}" x2="${w * 0.33}" y2="${h * 0.46}" stroke="#c9b79c" stroke-width="6"/>`);
    out.push(`<path d="M${w * 0.54} ${h * 0.46} L${w * 0.95} ${h} L${w * 0.25} ${h} Z" fill="#fff3c8" opacity="0.35"/>`);
    out.push(`<rect x="0" y="${h * 0.66}" width="${w}" height="${h * 0.34}" fill="${mix("#9c7350", accent, 0.08)}"/>`);
    out.push(`<rect x="0" y="${h * 0.66}" width="${w}" height="10" fill="${mix("#7a5236", "#000", 0.1)}"/>`);
    return out.join("");
  }

  if (type === "shopfront") {
    out.push(`<rect x="0" y="0" width="${w}" height="${ground}" fill="${mix(dark, "#3b3a40", 0.5)}"/>`);
    out.push(`<rect x="${w * 0.3}" y="${ground - h * 0.42}" width="${w * 0.4}" height="${h * 0.42}" fill="${mix("#f7c06b", accent, 0.3)}"/>`);
    out.push(`<path d="M${w * 0.3} ${ground} L${w * 0.7} ${ground} L${w * 0.95} ${h} L${w * 0.05} ${h} Z" fill="#f7c06b" opacity="0.35"/>`);
    out.push(`<rect x="0" y="${ground}" width="${w}" height="${h - ground}" fill="${mix(dark, "#2a2a30", 0.5)}" opacity="0.85"/>`);
    out.push(`<rect x="${w * 0.22}" y="${ground - h * 0.5}" width="${w * 0.56}" height="${h * 0.06}" fill="${mix(dark, "#5a4a3a", 0.7)}"/>`);
    return out.join("");
  }

  if (type === "plaza") {
    out.push(`<rect x="0" y="${ground}" width="${w}" height="${h - ground}" fill="${mix(dark, "#5b5560", 0.5)}"/>`);
    const n = Math.max(3, Math.round(w / 160));
    for (let i = 0; i < n; i++) {
      const x = (i * w) / n;
      out.push(`<rect x="${x + 6}" y="${ground - h * 0.3}" width="${w / n - 12}" height="${h * 0.3}" fill="${mix(dark, "#4a4650", 0.6)}"/>`);
      for (let k = 0; k < 8; k++) out.push(`<rect x="${x + 12}" y="${ground - h * 0.28 + k * 10}" width="${w / n - 24}" height="4" fill="#000" opacity="0.25"/>`);
    }
    out.push(`<rect x="${w * 0.78}" y="${ground - h * 0.4}" width="6" height="${h * 0.4}" fill="#222"/><circle cx="${w * 0.78 + 3}" cy="${ground - h * 0.4}" r="16" fill="${accent}"/>`);
    out.push(`<circle cx="${w * 0.78 + 3}" cy="${ground - h * 0.4}" r="80" fill="${accent}" opacity="0.12"/>`);
    return out.join("");
  }

  // Street, city, rooftop or anything else: a skyline with lit windows.
  const rooftop = !!el && has(`${el.name} ${el.description}`, ["rooftop", "roof"]);
  const base = rooftop ? h * 0.8 : ground;
  let x = 0;
  while (x < w) {
    const bw = 60 + r() * 110;
    const bh = h * (0.25 + r() * 0.35);
    const shade = mix(dark, "#2b3550", r() * 0.5);
    out.push(`<rect x="${x}" y="${base - bh}" width="${bw}" height="${bh}" fill="${shade}"/>`);
    for (let wy = base - bh + 14; wy < base - 18; wy += 26) {
      for (let wx = x + 10; wx < x + bw - 16; wx += 22) {
        if (r() < (lit ? 0.38 : 0.15)) out.push(`<rect x="${wx}" y="${wy}" width="10" height="14" fill="${lit ? accent : "#cfd8e3"}" opacity="${0.5 + r() * 0.5}"/>`);
      }
    }
    x += bw + 4;
  }
  out.push(`<rect x="0" y="${base}" width="${w}" height="${h - base}" fill="${mix(dark, "#1d2333", 0.4)}"/>`);
  if (lit) for (let i = 0; i < 6; i++) out.push(`<rect x="${r() * w}" y="${base + 10 + r() * (h - base - 20)}" width="${30 + r() * 80}" height="3" fill="${accent}" opacity="0.35"/>`);
  return out.join("");
}

function weather(text: string, w: number, h: number, r: () => number): string {
  if (!has(text, ["rain", "rainy", "wet", "storm", "drizzle"])) return "";
  const lines: string[] = [];
  for (let i = 0; i < 90; i++) {
    const x = r() * w;
    const y = r() * h;
    lines.push(`<line x1="${x}" y1="${y}" x2="${x - 6}" y2="${y + 22}" stroke="#c9d6ea" stroke-opacity="${0.25 + r() * 0.3}" stroke-width="1.5"/>`);
  }
  return lines.join("");
}

function figure(el: RenderElement, cx: number, baseY: number, scale: number, palette: string[]): string {
  const coat = el.color ?? palette[2] ?? "#c2563a";
  const skin = "#e7b98f";
  const text = `${el.name} ${el.description}`;
  const s = scale;
  const parts: string[] = [];
  if (has(text, ["bike", "bicycle", "cyclist", "cycles", "bikes"])) {
    parts.push(`<g stroke="#111" stroke-width="${5 * s}" fill="none"><circle cx="${cx - 60 * s}" cy="${baseY - 34 * s}" r="${34 * s}"/><circle cx="${cx + 60 * s}" cy="${baseY - 34 * s}" r="${34 * s}"/>
      <path d="M${cx - 60 * s} ${baseY - 34 * s} L${cx - 10 * s} ${baseY - 90 * s} L${cx + 60 * s} ${baseY - 34 * s} M${cx - 10 * s} ${baseY - 90 * s} L${cx + 40 * s} ${baseY - 96 * s}"/></g>`);
    baseY -= 70 * s;
  }
  parts.push(`<rect x="${cx - 22 * s}" y="${baseY - 70 * s}" width="${16 * s}" height="${70 * s}" rx="${6 * s}" fill="#22252c"/>`);
  parts.push(`<rect x="${cx + 6 * s}" y="${baseY - 70 * s}" width="${16 * s}" height="${70 * s}" rx="${6 * s}" fill="#22252c"/>`);
  parts.push(`<path d="M${cx - 44 * s} ${baseY - 60 * s} Q${cx - 40 * s} ${baseY - 190 * s} ${cx} ${baseY - 196 * s} Q${cx + 40 * s} ${baseY - 190 * s} ${cx + 44 * s} ${baseY - 60 * s} Z" fill="${coat}"/>`);
  parts.push(`<path d="M${cx - 44 * s} ${baseY - 60 * s} Q${cx} ${baseY - 50 * s} ${cx + 44 * s} ${baseY - 60 * s}" stroke="#000" stroke-opacity="0.25" stroke-width="${3 * s}" fill="none"/>`);
  parts.push(`<circle cx="${cx}" cy="${baseY - 222 * s}" r="${28 * s}" fill="${skin}"/>`);
  parts.push(`<path d="M${cx - 30 * s} ${baseY - 226 * s} Q${cx} ${baseY - 268 * s} ${cx + 30 * s} ${baseY - 226 * s} Z" fill="${has(text, ["hood", "raincoat", "hooded"]) ? coat : "#2c2320"}"/>`);
  return `<g>${parts.join("")}</g>`;
}

function prop(el: RenderElement, cx: number, cy: number, scale: number, palette: string[]): string {
  const text = `${el.name} ${el.description}`;
  const c = el.color ?? palette[1] ?? "#c9ced6";
  const s = scale;
  if (has(text, ["flask", "thermos", "bottle"])) {
    return `<g><rect x="${cx - 22 * s}" y="${cy - 70 * s}" width="${44 * s}" height="${120 * s}" rx="${14 * s}" fill="${c}"/>
      <rect x="${cx - 18 * s}" y="${cy - 92 * s}" width="${36 * s}" height="${26 * s}" rx="${6 * s}" fill="${mix(c, "#000", 0.35)}"/>
      <rect x="${cx - 14 * s}" y="${cy - 60 * s}" width="${8 * s}" height="${96 * s}" rx="${4 * s}" fill="#fff" opacity="0.35"/>${steam(cx, cy - 100 * s, s)}</g>`;
  }
  if (has(text, ["bike", "bicycle", "cycle"])) {
    const k = `stroke="${mix(c, "#000", 0.2)}" stroke-width="${6 * s}" fill="none" stroke-linecap="round"`;
    return `<g><circle cx="${cx - 52 * s}" cy="${cy + 20 * s}" r="${34 * s}" ${k}/><circle cx="${cx + 52 * s}" cy="${cy + 20 * s}" r="${34 * s}" ${k}/>
      <path d="M${cx - 52 * s} ${cy + 20 * s} L${cx - 10 * s} ${cy - 30 * s} L${cx + 40 * s} ${cy - 30 * s} L${cx + 52 * s} ${cy + 20 * s} M${cx - 10 * s} ${cy - 30 * s} L${cx + 6 * s} ${cy + 20 * s} L${cx + 40 * s} ${cy - 30 * s}" stroke="${c}" stroke-width="${7 * s}" fill="none" stroke-linejoin="round"/>
      <path d="M${cx - 16 * s} ${cy - 44 * s} h${18 * s} M${cx + 40 * s} ${cy - 30 * s} l${-6 * s} ${-20 * s} h${16 * s}" stroke="#222" stroke-width="${6 * s}" stroke-linecap="round"/>
      <rect x="${cx + 44 * s}" y="${cy - 44 * s}" width="${30 * s}" height="${18 * s}" rx="${3 * s}" fill="${mix(c, "#7a5236", 0.6)}"/></g>`;
  }
  if (has(text, ["mug", "cup", "teacup"])) {
    return `<g><path d="M${cx + 30 * s} ${cy - 30 * s} q${34 * s} 0 ${34 * s} ${26 * s} q0 ${26 * s} ${-34 * s} ${26 * s}" stroke="${c}" stroke-width="${10 * s}" fill="none"/>
      <rect x="${cx - 40 * s}" y="${cy - 50 * s}" width="${74 * s}" height="${84 * s}" rx="${12 * s}" fill="${c}"/>
      <ellipse cx="${cx - 3 * s}" cy="${cy - 50 * s}" rx="${37 * s}" ry="${8 * s}" fill="${mix(c, "#000", 0.3)}"/>${steam(cx, cy - 64 * s, s)}</g>`;
  }
  if (has(text, ["kite"])) {
    return `<g><path d="M${cx} ${cy - 70 * s} L${cx + 48 * s} ${cy} L${cx} ${cy + 80 * s} L${cx - 48 * s} ${cy} Z" fill="${c}"/>
      <path d="M${cx} ${cy - 70 * s} L${cx} ${cy + 80 * s} M${cx - 48 * s} ${cy} L${cx + 48 * s} ${cy}" stroke="#000" stroke-opacity="0.3" stroke-width="${3 * s}"/>
      <path d="M${cx} ${cy + 80 * s} q${30 * s} ${40 * s} 0 ${80 * s} q${-30 * s} ${40 * s} 0 ${80 * s}" stroke="${mix(c, "#fff", 0.4)}" stroke-width="${3 * s}" fill="none"/></g>`;
  }
  if (has(text, ["accordion", "guitar", "violin", "instrument"])) {
    const folds = Array.from({ length: 6 }, (_, i) => `<line x1="${cx - 40 * s + i * 16 * s}" y1="${cy - 40 * s}" x2="${cx - 40 * s + i * 16 * s}" y2="${cy + 40 * s}" stroke="#000" stroke-opacity="0.35" stroke-width="${3 * s}"/>`).join("");
    return `<g><rect x="${cx - 70 * s}" y="${cy - 44 * s}" width="${30 * s}" height="${88 * s}" rx="${6 * s}" fill="${mix(c, "#000", 0.3)}"/><rect x="${cx - 40 * s}" y="${cy - 40 * s}" width="${80 * s}" height="${80 * s}" fill="${c}"/>${folds}
      <rect x="${cx + 40 * s}" y="${cy - 44 * s}" width="${30 * s}" height="${88 * s}" rx="${6 * s}" fill="${mix(c, "#000", 0.3)}"/></g>`;
  }
  if (has(text, ["dumpling", "bun", "bao"])) {
    return `<g><ellipse cx="${cx}" cy="${cy + 26 * s}" rx="${70 * s}" ry="${14 * s}" fill="#f2f0ea"/><path d="M${cx - 50 * s} ${cy + 20 * s} Q${cx} ${cy - 60 * s} ${cx + 50 * s} ${cy + 20 * s} Z" fill="${mix("#f3e3c3", c, 0.15)}"/>
      ${[0, 1, 2, 3].map((i) => `<path d="M${cx - 30 * s + i * 20 * s} ${cy - 4 * s} q${6 * s} ${-14 * s} ${12 * s} 0" stroke="#c9b48e" stroke-width="${3 * s}" fill="none"/>`).join("")}${steam(cx, cy - 40 * s, s)}</g>`;
  }
  return `<g><rect x="${cx - 40 * s}" y="${cy - 40 * s}" width="${80 * s}" height="${80 * s}" rx="${14 * s}" fill="${c}"/><rect x="${cx - 40 * s}" y="${cy - 40 * s}" width="${80 * s}" height="${18 * s}" rx="${8 * s}" fill="#fff" opacity="0.2"/></g>`;
}

function steam(cx: number, top: number, s: number): string {
  return [-14, 0, 14]
    .map((dx) => `<path d="M${cx + dx * s} ${top} q${10 * s} ${-16 * s} 0 ${-32 * s} q${-10 * s} ${-16 * s} 0 ${-32 * s}" stroke="#fff" stroke-opacity="0.45" stroke-width="${3 * s}" fill="none" stroke-linecap="round"/>`)
    .join("");
}

function sun(tod: TimeOfDay, w: number, h: number, palette: string[]): string {
  if (tod === "dawn" || tod === "dusk") {
    const c = mix("#ffd27a", palette[1] ?? "#f0a43a", 0.3);
    return `<circle cx="${w * 0.7}" cy="${h * 0.6}" r="${Math.min(w, h) * 0.12}" fill="${c}"/><circle cx="${w * 0.7}" cy="${h * 0.6}" r="${Math.min(w, h) * 0.3}" fill="${c}" opacity="0.18"/>`;
  }
  if (tod === "night") return `<circle cx="${w * 0.8}" cy="${h * 0.14}" r="${Math.min(w, h) * 0.04}" fill="#e9eef7" opacity="0.8"/>`;
  return `<circle cx="${w * 0.8}" cy="${h * 0.16}" r="${Math.min(w, h) * 0.06}" fill="#fff6d6"/>`;
}

function wrap(w: number, h: number, body: string, top: string, bottom: string, labelRight: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>
  <radialGradient id="vig" cx="0.5" cy="0.5" r="0.75"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></radialGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#sky)"/>${body}<rect width="${w}" height="${h}" fill="url(#vig)"/>${stamp(w, labelRight)}</svg>`;
}

/** One reference image for an element (a look). */
export function renderReference(el: RenderElement, palette: string[]): string {
  const [w, h] = [600, 600];
  const r = rng(`${el.id}:${el.version}`);
  const tod: TimeOfDay = has(el.description, ["night", "dark"]) ? "night" : has(el.description, ["dawn", "sunrise"]) ? "dawn" : "day";
  const [top, bottom] = el.kind === "location" ? sky(tod, palette) : [mix("#20232b", palette[0] ?? "#20232b", 0.25), mix("#3a3f4b", palette[0] ?? "#3a3f4b", 0.2)];
  let body = "";
  if (el.kind === "location") body = sun(tod, w, h, palette) + location(el, w, h, tod, palette, r) + weather(el.description, w, h, r);
  else if (el.kind === "cast") body = `<ellipse cx="300" cy="560" rx="150" ry="18" fill="#000" opacity="0.3"/>` + figure(el, 300, 560, 1.7, palette);
  else body = `<ellipse cx="300" cy="420" rx="120" ry="16" fill="#000" opacity="0.3"/>` + prop(el, 300, 320, 2, palette);
  return wrap(w, h, body, top, bottom, `${el.name} - take ${el.version}`);
}

/** A first frame for a scene, composed from the approved looks. */
export function renderFrame(input: FrameInput): string {
  const [w, h] = sizeFor(input.aspect);
  const r = rng(`frame:${input.sceneN}:${input.elements.map((e) => `${e.id}@${e.version}`).join(",")}`);
  const tod = timeOfDay(input.heading);
  const [top, bottom] = sky(tod, input.palette);
  const loc = input.elements.find((e) => e.kind === "location");
  const cast = input.elements.filter((e) => e.kind === "cast");
  const props = input.elements.filter((e) => e.kind === "prop");
  const ground = h * 0.86;
  const scale = Math.min(w, h) / 600;
  let body = sun(tod, w, h, input.palette) + location(loc, w, h, tod, input.palette, r);
  cast.forEach((c, i) => {
    const cx = cast.length === 1 ? w * (props.length ? 0.34 : 0.5) : w * (0.26 + (0.44 * i) / Math.max(1, cast.length - 1));
    const fs = scale * (input.aspect === "16:9" ? 1.25 : 1.6);
    body += `<ellipse cx="${cx}" cy="${ground}" rx="${70 * fs}" ry="${10 * fs}" fill="#000" opacity="0.35"/>` + figure(c, cx, ground, fs, input.palette);
  });
  props.forEach((p, i) => {
    const ps = scale * (input.aspect === "16:9" ? 0.9 : 1.1);
    body += prop(p, w * (0.76 - i * 0.2), h * (0.8 - i * 0.04), ps, input.palette);
  });
  body += weather(`${loc?.description ?? ""} ${input.heading}`, w, h, r);
  return wrap(w, h, body, top, bottom, `Scene ${input.sceneN}`);
}
