import sharp from "sharp";

/**
 * Headline-area mask for fal-ai/ideogram/v3/edit.
 *
 * Official Ideogram edit (and therefore fal's wrapper) treats black as the
 * region to change and white as the region to keep — the opposite of the usual
 * inpaint convention. The mask must be the exact width and height of
 * `image_url`.
 *
 * https://developer.ideogram.ai/v1/api-reference/legacy-endpoints/edit-v3
 * https://fal.ai/models/fal-ai/ideogram/v3/edit/api
 */

/** Black pixels are the area Ideogram will letter. */
export const IDEOGRAM_MASK_EDIT = 0;
/** White pixels are copied through from the Gemini scene. */
export const IDEOGRAM_MASK_KEEP = 255;

/** Fraction of the frame used as the headline band. */
export const HEADLINE_MASK_BAND_FRACTION = 0.32;

export type HeadlineBand = "top" | "bottom";

export interface HeadlineMask {
  bytes: Uint8Array;
  width: number;
  height: number;
  band: HeadlineBand;
  /** Inclusive start row of the black (edit) band. */
  y0: number;
  /** Exclusive end row of the black (edit) band. */
  y1: number;
}

/**
 * Pick the emptier horizontal band so lettering lands in leftover space.
 *
 * Variance of luma is the emptiness score: a flat sky or empty dark field is
 * low, a busy product shot is high. When the two bands are close, the top
 * wins — that is the space the textless Gemini brief is asked to leave, and
 * the fallback overlay uses it too.
 */
export async function chooseHeadlineBand(
  source: Uint8Array,
): Promise<HeadlineBand> {
  const { data, info } = await sharp(source)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const fraction = HEADLINE_MASK_BAND_FRACTION;
  const bandRows = Math.max(1, Math.round(height * fraction));
  const top = lumaVariance(data, width, height, channels, 0, bandRows);
  const bottom = lumaVariance(
    data,
    width,
    height,
    channels,
    height - bandRows,
    height,
  );
  // Prefer top unless the bottom is clearly emptier. An absolute margin
  // keeps two nearly-flat bands from flipping on rounding noise: a busy
  // product and an empty field differ by thousands of variance units.
  if (top - bottom > 200) return "bottom";
  return "top";
}

function lumaVariance(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  y0: number,
  y1: number,
): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  const start = Math.max(0, y0);
  const end = Math.min(height, y1);
  for (let y = start; y < end; y += 1) {
    const row = y * width * channels;
    for (let x = 0; x < width; x += 1) {
      const i = row + x * channels;
      const luma =
        0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
      sum += luma;
      sumSq += luma * luma;
      n += 1;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/**
 * Build a same-size PNG mask: a black headline band, white everywhere else.
 */
export async function renderHeadlineMask(
  source: Uint8Array,
  band?: HeadlineBand,
): Promise<HeadlineMask> {
  const image = sharp(source).rotate().ensureAlpha();
  const { width, height } = await image.metadata();
  if (!width || !height) {
    throw new Error(
      "Cannot read the backdrop dimensions for a lettering mask.",
    );
  }
  const chosen = band ?? (await chooseHeadlineBand(source));
  const bandRows = Math.max(
    1,
    Math.round(height * HEADLINE_MASK_BAND_FRACTION),
  );
  const y0 = chosen === "top" ? 0 : height - bandRows;
  const y1 = chosen === "top" ? bandRows : height;
  const pixels = Buffer.alloc(width * height, IDEOGRAM_MASK_KEEP);
  for (let y = y0; y < y1; y += 1) {
    pixels.fill(IDEOGRAM_MASK_EDIT, y * width, (y + 1) * width);
  }
  const bytes = await sharp(pixels, {
    raw: { width, height, channels: 1 },
  })
    .png()
    .toBuffer();
  return { bytes, width, height, band: chosen, y0, y1 };
}
