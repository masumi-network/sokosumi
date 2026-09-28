/**
 * What one generated image costs, derived from fal's own published list price.
 *
 * Shared rather than Core-only because three numbers have to be the same number:
 * the estimate the composer shows before anybody presses generate, the quote the
 * studio writes on the job row at submit, and the debit it takes **when the image
 * is delivered**. Two implementations of this formula is a promise to the person
 * that the ledger then quietly breaks, so the catalog row carries fal's figures
 * and every side runs this.
 *
 * Nothing is taken at submit: the studio charges on success, so a generation that
 * fails costs nothing and is never refunded, because nothing was ever taken.
 *
 * 1 credit = 1 cent, and there is no markup on fal's list price.
 */

/** fal's pricing units, verbatim from `GET /v1/models/pricing`. */
export const IMAGE_PRICE_UNITS = [
  "images",
  "generations",
  "megapixels",
  "processed megapixels",
  "compute seconds",
  "units",
  "credits",
] as const;

export type ImagePriceUnit = (typeof IMAGE_PRICE_UNITS)[number];

/** Units that already describe exactly one image. */
const PER_IMAGE_UNITS: readonly string[] = ["images", "generations"];

/** Units priced by output area, so the frame the studio asks for decides. */
const PER_MEGAPIXEL_UNITS: readonly string[] = [
  "megapixels",
  "processed megapixels",
];

/**
 * fal's figures for one endpoint, plus the hand-verified exception.
 *
 * `perImageUsd` exists because a unit price is not always the whole story: fal
 * lists Gemini at "$0.08 per image" and then multiplies that by 0.75 at 512px
 * and 1.5 at 2K, which no unit alone can express. Where a human has read the
 * model's own pricing page and written the per-tier figures down, those win.
 */
export interface ImagePriceFigures {
  unit: string;
  /** USD per `unit`, as fal's pricing API returns it. */
  unitPriceUsd: number;
  /** USD per image by studio resolution tier. Hand-verified where present. */
  perImageUsd?: Partial<Record<string, number>> | null;
}

export interface ImageFrame {
  aspectRatio: string;
  resolution: string;
  /**
   * True when the provider decides the output size and the studio only asks for a
   * ratio.
   *
   * It matters because the area below is then a *guess*, and an area-priced model
   * bills the area it actually produced. Measured live on `fal-ai/nucleus-image`
   * at 16:9 1K: the studio assumed 1024x576 (0.590 MP) and charged 1 credit, the
   * provider returned 1344x768 (1.032 MP) and fal billed 2 cents. At 1:1 the
   * provider happened to return 1024x1024 and the two agreed, which is precisely
   * why it hid.
   *
   * So with this set, an area-priced unit is *not derivable* and returns null. A
   * caller that omits it is asserting the studio told the provider the exact
   * pixel dimensions.
   */
  providerChoosesSize?: boolean;
}

/** Longest edge in pixels for each studio resolution tier. */
function longestEdge(resolution: string): number {
  if (resolution === "2K") return 2048;
  if (resolution === "0.5K") return 512;
  return 1024;
}

/**
 * Pixel dimensions the studio asks for at a given frame.
 *
 * Aligned to 32 pixels because providers that take explicit dimensions reject
 * or silently round anything else, so the aspect ratio can come out slightly
 * off — which is why this is the one place that decides it.
 */
export function imageOutputDimensions(
  aspectRatio: string,
  resolution: string,
): { width: number; height: number } {
  const [width, height] = aspectRatio.split(":").map(Number);
  const edge = longestEdge(resolution);
  const longest = Math.max(width ?? 1, height ?? 1);
  return {
    width: Math.round((edge * (width ?? 1)) / longest / 32) * 32,
    height: Math.round((edge * (height ?? 1)) / longest / 32) * 32,
  };
}

/** Output area in megapixels, which is what an area-priced unit bills. */
export function imageOutputMegapixels(
  aspectRatio: string,
  resolution: string,
): number {
  const { width, height } = imageOutputDimensions(aspectRatio, resolution);
  return (width * height) / 1_000_000;
}

/**
 * Credits (= cents) for one image at this frame, or null when fal's figures do
 * not describe a per-image cost at all.
 *
 * Null is a real answer and callers must respect it: a model priced by compute
 * second cannot be charged for per image without inventing a number, and
 * inventing one here is how a studio starts overcharging quietly. Such a model
 * is kept out of the catalog instead.
 */
export function creditsPerImageCents(
  price: ImagePriceFigures,
  frame: ImageFrame,
): number | null {
  const verified = price.perImageUsd?.[frame.resolution];
  if (typeof verified === "number" && Number.isFinite(verified)) {
    return Math.ceil(verified * 100);
  }
  if (!Number.isFinite(price.unitPriceUsd) || price.unitPriceUsd < 0) {
    return null;
  }
  if (PER_IMAGE_UNITS.includes(price.unit)) {
    return Math.ceil(price.unitPriceUsd * 100);
  }
  if (PER_MEGAPIXEL_UNITS.includes(price.unit)) {
    // Priced on an area nobody here chose. Guessing it undercharges or
    // overcharges by whatever the provider felt like returning, and the studio
    // does not bill a number it cannot stand behind.
    if (frame.providerChoosesSize) return null;
    const megapixels = imageOutputMegapixels(
      frame.aspectRatio,
      frame.resolution,
    );
    if (!Number.isFinite(megapixels) || megapixels <= 0) return null;
    return Math.ceil(price.unitPriceUsd * megapixels * 100);
  }
  // compute seconds, units, credits: how long a run takes or how many internal
  // units it consumes is not knowable before it runs.
  return null;
}

/** True when this unit alone yields a per-image figure for any frame. */
export function isPerImageDerivableUnit(unit: string): boolean {
  return PER_IMAGE_UNITS.includes(unit) || PER_MEGAPIXEL_UNITS.includes(unit);
}

/** True when this unit bills the output area rather than the image. */
export function isAreaPricedUnit(unit: string): boolean {
  return PER_MEGAPIXEL_UNITS.includes(unit);
}
