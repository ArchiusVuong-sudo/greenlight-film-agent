import type { ImageModel, JobKind, Resolution, VideoModel } from "./types";

/** Synthetic model catalog. Prices are invented credits, not real vendor prices. */
export const IMAGE_PRICES: Record<ImageModel, { perImage: number; label: string }> = {
  "sim-image-fast": { perImage: 1, label: "Fast drafts, flat light" },
  "sim-image-pro": { perImage: 4, label: "Detailed looks and frames" },
};

export const VIDEO_PRICES: Record<VideoModel, { perSecond: Partial<Record<Resolution, number>>; label: string }> = {
  "sim-video-lite": { perSecond: { "720p": 2.5 }, label: "720p only, simple motion" },
  "sim-video-pro": { perSecond: { "720p": 4, "1080p": 7 }, label: "720p or 1080p, smooth camera moves" },
};

/** Each reference image fed into a frame or clip adds this much. */
export const REF_INPUT_SURCHARGE = 0.5;

export interface PriceLine {
  kind: JobKind;
  target: string;
  model: string;
  resolution?: Resolution;
  seconds?: number;
  refInputs: number;
}

export interface PricedLine extends PriceLine {
  unit: string;
  exact: number;
}

export interface PricedRequest {
  lines: PricedLine[];
  /** Sum of the exact line prices, rounded up once for the whole request. */
  total: number;
}

export class PricingError extends Error {}

export function isImageModel(m: string): m is ImageModel {
  return m in IMAGE_PRICES;
}
export function isVideoModel(m: string): m is VideoModel {
  return m in VIDEO_PRICES;
}

export function priceLine(line: PriceLine): PricedLine {
  const surcharge = line.refInputs * REF_INPUT_SURCHARGE;
  if (line.kind === "clip") {
    if (!isVideoModel(line.model)) throw new PricingError(`${line.model} is not a video model. Use ${Object.keys(VIDEO_PRICES).join(" or ")}.`);
    const res = line.resolution ?? "720p";
    const perSecond = VIDEO_PRICES[line.model].perSecond[res];
    if (perSecond === undefined) throw new PricingError(`${line.model} does not render ${res}.`);
    const seconds = line.seconds ?? 0;
    return { ...line, resolution: res, unit: `${perSecond} cr/s x ${seconds} s`, exact: perSecond * seconds + surcharge };
  }
  if (!isImageModel(line.model)) throw new PricingError(`${line.model} is not an image model. Use ${Object.keys(IMAGE_PRICES).join(" or ")}.`);
  const perImage = IMAGE_PRICES[line.model].perImage;
  return { ...line, unit: `${perImage} cr/image`, exact: perImage + surcharge };
}

export function priceRequest(lines: PriceLine[]): PricedRequest {
  const priced = lines.map(priceLine);
  const sum = priced.reduce((acc, l) => acc + l.exact, 0);
  // Round once at the request level, with a small epsilon so 12.000000001 does not become 13.
  const total = Math.ceil(sum - 1e-9);
  return { lines: priced, total: Math.max(total, 0) };
}

/**
 * Splits a rounded request total into whole-credit holds per line (largest remainder),
 * so the holds always add up to exactly the quoted total.
 */
export function allocate(exact: number[], total: number): number[] {
  const floors = exact.map((x) => Math.floor(x + 1e-9));
  let rest = total - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x + 1e-9) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = [...floors];
  let k = 0;
  while (rest > 0 && order.length > 0) {
    const slot = order[k % order.length]!;
    out[slot.i] = (out[slot.i] ?? 0) + 1;
    rest -= 1;
    k += 1;
  }
  return out;
}

export function catalogSummary(): string {
  const img = Object.entries(IMAGE_PRICES).map(([m, p]) => `${m}: ${p.perImage} cr per image (${p.label})`);
  const vid = Object.entries(VIDEO_PRICES).map(
    ([m, p]) => `${m}: ${Object.entries(p.perSecond).map(([r, v]) => `${v} cr/s at ${r}`).join(", ")} (${p.label})`,
  );
  return [...img, ...vid, `Reference inputs: +${REF_INPUT_SURCHARGE} cr each`].join("\n");
}
