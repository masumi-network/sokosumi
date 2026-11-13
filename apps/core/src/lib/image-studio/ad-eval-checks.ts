import { normalizeHex } from "@sokosumi/utils";

export type AdEvalCheck = {
  id:
    | "aspect_ok"
    | "size_ok"
    | "palette_adherence"
    | "text_match"
    | "garbled_text"
    | "logo_present"
    | "safety";
  pass: boolean | null;
  value: number | boolean | null;
};

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface DominantColor extends RgbColor {
  weight: number;
}

export interface LabColor {
  l: number;
  a: number;
  b: number;
}

export interface AdEvalObservations {
  text: string[];
  garbledText: boolean;
  safe: boolean;
  logoPresent: boolean | null;
}

interface AdHardCheckInput {
  width: number | null;
  height: number | null;
  aspectRatio: string;
  dominantColors: DominantColor[];
  brandColors: string[];
  expectedText: string[];
  prompt: string;
  useProductCutout: boolean;
  logoRequested?: boolean;
  falNsfw?: boolean;
  observations: AdEvalObservations;
}

// Studio's four ad placements share a 1080px minimum short side in rubric v1.
const MINIMUM_SHORT_SIDE: Record<string, number> = {
  "1:1": 1080,
  "4:5": 1080,
  "9:16": 1080,
  "16:9": 1080,
};
const MAX_PALETTE_DELTA_E = 20;

export function evaluateAdHardChecks(input: AdHardCheckInput): AdEvalCheck[] {
  const {
    width,
    height,
    aspectRatio,
    dominantColors,
    brandColors,
    expectedText,
    observations,
  } = input;
  const [requestedWidth, requestedHeight] = aspectRatio.split(":").map(Number);
  const requestedAspect = requestedWidth / requestedHeight;
  const validDimensions =
    width !== null &&
    height !== null &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0;
  const aspectError =
    validDimensions && Number.isFinite(requestedAspect) && requestedAspect > 0
      ? Math.abs(width / height / requestedAspect - 1)
      : null;
  const minShortSide = MINIMUM_SHORT_SIDE[aspectRatio];
  const shortSide = validDimensions ? Math.min(width, height) : null;
  const paletteDelta = paletteDistance(dominantColors, brandColors);
  const skipText =
    input.useProductCutout ||
    /\b(?:no|without)\s+(?:(?:any|visible|rendered|overlaid)\s+)?(?:text|copy|headlines?|typography|lettering)\b|\btext[- ]free\b|\bdo not (?:add|include|render) (?:any )?text\b|\bleave (?:marketing )?text out\b/i.test(
      input.prompt,
    );
  const expectedLines = expectedText.filter((line) => normalizeText(line));
  const actualLines = [...observations.text, observations.text.join(" ")];
  const textMatch =
    skipText || expectedLines.length === 0
      ? null
      : Math.max(
          0,
          ...expectedLines.flatMap((expected) =>
            actualLines.map((actual) =>
              normalizedTextSimilarity(expected, actual),
            ),
          ),
        );

  return [
    {
      id: "aspect_ok",
      pass: aspectError === null ? null : aspectError <= 0.01 + Number.EPSILON,
      value: aspectError,
    },
    {
      id: "size_ok",
      pass: minShortSide
        ? shortSide !== null && shortSide >= minShortSide
        : null,
      value: shortSide,
    },
    {
      id: "palette_adherence",
      pass: paletteDelta === null ? null : paletteDelta <= MAX_PALETTE_DELTA_E,
      value: paletteDelta,
    },
    {
      id: "text_match",
      pass: textMatch === null ? null : textMatch >= 0.9,
      value: textMatch,
    },
    {
      id: "garbled_text",
      pass: !observations.garbledText,
      value: observations.garbledText,
    },
    {
      id: "logo_present",
      pass: input.logoRequested ? observations.logoPresent : null,
      value: input.logoRequested ? observations.logoPresent : null,
    },
    {
      id: "safety",
      pass: !input.falNsfw && observations.safe,
      value: !input.falNsfw && observations.safe,
    },
  ];
}

function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizedTextSimilarity(
  expected: string,
  actual: string,
): number {
  const left = Array.from(normalizeText(expected));
  const right = Array.from(normalizeText(actual));
  if (!left.length && !right.length) return 1;
  if (!left.length || !right.length) return 0;
  const distances = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    let diagonal = distances[0];
    distances[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const above = distances[j];
      distances[j] = Math.min(
        above + 1,
        distances[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return 1 - distances[right.length] / Math.max(left.length, right.length);
}

/** Deterministic five-color k-means over a small, decoded RGBA image. */
export function extractDominantColors(rgba: Uint8Array): DominantColor[] {
  const histogram = new Map<number, DominantColor>();
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const weight = rgba[i + 3] / 255;
    if (!weight) continue;
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    const existing = histogram.get(key);
    if (existing) existing.weight += weight;
    else
      histogram.set(key, {
        r: rgba[i],
        g: rgba[i + 1],
        b: rgba[i + 2],
        weight,
      });
  }
  const pixels = [...histogram.values()].sort(
    (left, right) => right.weight - left.weight,
  );
  if (!pixels.length) return [];
  let centers: RgbColor[] = [pixels[0]];
  while (centers.length < Math.min(5, pixels.length)) {
    let next = pixels[0];
    let furthest = 0;
    for (const pixel of pixels) {
      const distance =
        Math.min(
          ...centers.map((center) => colorDistanceSquared(pixel, center)),
        ) * pixel.weight;
      if (distance > furthest) {
        furthest = distance;
        next = pixel;
      }
    }
    if (!furthest) break;
    centers.push(next);
  }
  let clusters: DominantColor[] = [];
  for (let iteration = 0; iteration < 12; iteration++) {
    clusters = centers.map(() => ({ r: 0, g: 0, b: 0, weight: 0 }));
    for (const pixel of pixels) {
      let nearest = 0;
      for (let i = 1; i < centers.length; i++) {
        if (
          colorDistanceSquared(pixel, centers[i]) <
          colorDistanceSquared(pixel, centers[nearest])
        )
          nearest = i;
      }
      const cluster = clusters[nearest];
      cluster.r += pixel.r * pixel.weight;
      cluster.g += pixel.g * pixel.weight;
      cluster.b += pixel.b * pixel.weight;
      cluster.weight += pixel.weight;
    }
    clusters = clusters
      .filter((cluster) => cluster.weight > 0)
      .map((cluster) => ({
        r: cluster.r / cluster.weight,
        g: cluster.g / cluster.weight,
        b: cluster.b / cluster.weight,
        weight: cluster.weight,
      }));
    const settled =
      clusters.length === centers.length &&
      clusters.every(
        (cluster, i) => colorDistanceSquared(cluster, centers[i]) < 0.01,
      );
    centers = clusters;
    if (settled) break;
  }
  const total = clusters.reduce((sum, cluster) => sum + cluster.weight, 0);
  return clusters
    .map((cluster) => ({ ...cluster, weight: cluster.weight / total }))
    .sort((left, right) => right.weight - left.weight);
}

function colorDistanceSquared(left: RgbColor, right: RgbColor): number {
  return (
    (left.r - right.r) ** 2 + (left.g - right.g) ** 2 + (left.b - right.b) ** 2
  );
}

function paletteDistance(
  colors: DominantColor[],
  palette: string[],
): number | null {
  const brand = palette.flatMap((color) => {
    const hex = normalizeHex(color);
    return hex
      ? [
          rgbToLab({
            r: Number.parseInt(hex.slice(1, 3), 16),
            g: Number.parseInt(hex.slice(3, 5), 16),
            b: Number.parseInt(hex.slice(5, 7), 16),
          }),
        ]
      : [];
  });
  const weightedColors = colors.filter(
    (color) => Number.isFinite(color.weight) && color.weight > 0,
  );
  if (!brand.length || !weightedColors.length) return null;
  const total = weightedColors.reduce((sum, color) => sum + color.weight, 0);
  return (
    weightedColors.reduce(
      (sum, color) =>
        sum +
        color.weight *
          Math.min(
            ...brand.map((target) => deltaE2000(rgbToLab(color), target)),
          ),
      0,
    ) / total
  );
}

function rgbToLab(color: RgbColor): LabColor {
  const [r, g, b] = [color.r, color.g, color.b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  function labComponent(value: number): number {
    return value > 216 / 24389
      ? Math.cbrt(value)
      : ((24389 / 27) * value + 16) / 116;
  }
  const x = labComponent(
    (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047,
  );
  const y = labComponent(r * 0.2126729 + g * 0.7151522 + b * 0.072175);
  const z = labComponent(
    (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883,
  );
  return { l: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) };
}

/** CIEDE2000 with unit parametric factors; Sharma, Wu and Dalal (2005). */
export function deltaE2000(left: LabColor, right: LabColor): number {
  const radians = Math.PI / 180;
  const meanChroma =
    (Math.hypot(left.a, left.b) + Math.hypot(right.a, right.b)) / 2;
  const correction =
    0.5 * (1 - Math.sqrt(meanChroma ** 7 / (meanChroma ** 7 + 25 ** 7)));
  const a1 = left.a * (1 + correction);
  const a2 = right.a * (1 + correction);
  const c1 = Math.hypot(a1, left.b);
  const c2 = Math.hypot(a2, right.b);
  const h1 = (Math.atan2(left.b, a1) / radians + 360) % 360;
  const h2 = (Math.atan2(right.b, a2) / radians + 360) % 360;
  const deltaL = right.l - left.l;
  const deltaC = c2 - c1;
  let deltaHue = c1 * c2 === 0 ? 0 : h2 - h1;
  if (deltaHue > 180) deltaHue -= 360;
  if (deltaHue < -180) deltaHue += 360;
  const deltaH = 2 * Math.sqrt(c1 * c2) * Math.sin((deltaHue / 2) * radians);
  const meanL = (left.l + right.l) / 2;
  const meanC = (c1 + c2) / 2;
  let meanHue = h1 + h2;
  if (c1 * c2 !== 0) {
    if (Math.abs(h1 - h2) <= 180) meanHue /= 2;
    else meanHue = (meanHue + (meanHue < 360 ? 360 : -360)) / 2;
  }
  const t =
    1 -
    0.17 * Math.cos((meanHue - 30) * radians) +
    0.24 * Math.cos(2 * meanHue * radians) +
    0.32 * Math.cos((3 * meanHue + 6) * radians) -
    0.2 * Math.cos((4 * meanHue - 63) * radians);
  const sL =
    1 + (0.015 * (meanL - 50) ** 2) / Math.sqrt(20 + (meanL - 50) ** 2);
  const sC = 1 + 0.045 * meanC;
  const sH = 1 + 0.015 * meanC * t;
  const rotation =
    -2 *
    Math.sqrt(meanC ** 7 / (meanC ** 7 + 25 ** 7)) *
    Math.sin(60 * Math.exp(-(((meanHue - 275) / 25) ** 2)) * radians);
  return Math.sqrt(
    (deltaL / sL) ** 2 +
      (deltaC / sC) ** 2 +
      (deltaH / sH) ** 2 +
      (((rotation * deltaC) / sC) * deltaH) / sH,
  );
}
