import { MODE_DRAWS, type OrbState, resolvePreset } from "thinking-orbs";

import {
  drawEyes,
  faceTraits,
  type OrbExpression,
  params,
} from "@/lib/aurora-orb";

/**
 * The assistant's dotted identity body — the thinking-orbs "globe" sampled
 * in the orb palette's own material. This is the personal assistant's
 * standard look everywhere (task comments, sidenav, landing, chat); the
 * activity states (working/solving/composing…) are the same material in
 * motion.
 */
export const DOTTED_IDENTITY_STATE: OrbState = "searching";

/** Frozen timestamp for static renders — chosen for an even, calm dot
 * distribution with the scan sweep parked out of sight. */
const STATIC_T = 1.35;

/**
 * The published presets are hand-tuned for 64 and 20 CSS px only. For other
 * sizes, scale the 64 preset's dot radii linearly and keep every count
 * unchanged — the geometry then scales uniformly, reproducing the tuned
 * 64px density at any size (adding dots instead melts large orbs into a
 * solid mass).
 */
export function dottedPreset(state: OrbState, size: number) {
  if (size === 64 || size === 20) return resolvePreset(state, size);
  const base = resolvePreset(state, 64);
  const k = size / 64;
  const opts = { ...base.opts };
  for (const key of ["rBase", "rDepth", "partR", "partRDepth", "ghostR"]) {
    if (typeof opts[key] === "number") opts[key] = opts[key] * k;
  }
  return { ...base, opts };
}

export interface DottedOrbDrawOptions {
  dark: boolean;
  expression?: OrbExpression | null;
  state?: OrbState;
  /** Animation time in seconds; omit for the frozen identity frame. */
  t?: number;
  /** 0..1 eyes-open scale (blink); default fully open. */
  eyesOpen?: number;
  gazeX?: number;
  gazeY?: number;
}

/**
 * Paint one frame of the dotted assistant orb at CSS-px `size` into `ctx`
 * (already dpr-scaled by the caller): the thinking-orbs painter, every dot
 * refilled with the seed's body gradient via source-in, eyes on top in the
 * palette ink (light ink over dark backgrounds — the dots sit on the page,
 * not on a solid body).
 */
export function drawDottedOrb(
  ctx: CanvasRenderingContext2D,
  size: number,
  seed: string,
  {
    dark,
    expression,
    state = DOTTED_IDENTITY_STATE,
    t = STATIC_T,
    eyesOpen = 1,
    gazeX = 0,
    gazeY = 0,
  }: DottedOrbDrawOptions,
): void {
  const { mode, opts } = dottedPreset(state, size);
  const { paint, paletteId } = params(seed);
  // The resting identity frame lifts the globe preset's dim floor: static
  // dots at the animated sweep's 0.45 idle alpha wash out pastel palettes
  // on light pages and the ink palette on dark ones.
  const frameOpts =
    state === DOTTED_IDENTITY_STATE
      ? { ...opts, dimBase: Math.max(0.85, (opts.dimBase as number) ?? 0) }
      : opts;

  ctx.clearRect(0, 0, size, size);
  MODE_DRAWS[mode](ctx, size, t, dark, frameOpts);

  // One material: the same radial body gradient the solid discs use
  // (light point at 38%/30%), applied to every dot. Exceptions keep the
  // painter's native theme-aware neutral ink: porcelain (white dots would
  // vanish on light pages — and neutral doubles as the "no colour chosen"
  // signal) and the ink palette in dark mode (its near-black stops would
  // vanish on the dark page).
  const keepNativeInk =
    paletteId === "porcelain" || (paletteId === "ink" && dark);
  if (!keepNativeInk) {
    const cx = size / 2;
    const cy = size / 2;
    const R = size * 0.46;
    const material = ctx.createRadialGradient(
      cx - R * 0.24,
      cy - R * 0.4,
      0,
      cx - R * 0.24,
      cy - R * 0.4,
      R * 1.7,
    );
    material.addColorStop(0, paint.stops[0]);
    material.addColorStop(0.55, paint.stops[1]);
    material.addColorStop(1, dark ? paint.stops[1] : paint.stops[2]);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = material;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = "source-over";
  }

  if (expression) {
    // Eye ink contrasts with the PAGE, not the palette: unlike the solid
    // discs there is no body behind the eyes, so palette-tuned inks (the
    // ink palette's near-white, tuned for its dark disc) would vanish.
    // Seeded face traits keep two assistants with the same colour from
    // sharing the exact same face — parity with the old disc renderer.
    drawEyes(
      ctx,
      size,
      expression,
      { blink: eyesOpen, open: eyesOpen, lift: 0, gazeX, gazeY },
      faceTraits(seed, paletteId === "porcelain"),
      dark ? "rgba(240,238,248,0.95)" : "rgba(10,8,16,0.95)",
    );
  }
}

/**
 * Below-preset sizes render at the nearest hand-tuned preset size and let
 * CSS downscale — the 64 tuning survives shrinking to avatar slots far
 * better than linearly shrunken dot radii survive direct painting.
 */
export function dottedPaintSize(size: number): number {
  if (size <= 20) return 20;
  return Math.max(size, 64);
}

/**
 * Static dotted orb as a PNG data URL — the cheap path for the many
 * non-animated surfaces (message rows, task comments, landing). Rendered
 * at 2x for crispness regardless of devicePixelRatio.
 */
const dataURLCache = new Map<string, string>();

export function dottedOrbDataURL(
  seed: string,
  size: number,
  options: Omit<DottedOrbDrawOptions, "t" | "eyesOpen" | "gazeX" | "gazeY">,
): string {
  const paintSize = dottedPaintSize(size);
  const state = options.state ?? DOTTED_IDENTITY_STATE;
  // Bounded: a handful of seeds x 2 themes x few paint sizes x expressions.
  // Same pattern as the old aurora toDataURL cache — chat/task lists render
  // dozens of identical static rows and theme flips re-request all of them.
  const key = `${seed}:${paintSize}:${options.dark}:${options.expression ?? ""}:${state}`;
  const cached = dataURLCache.get(key);
  if (cached) return cached;

  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = paintSize * scale;
  canvas.height = paintSize * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.scale(scale, scale);
  drawDottedOrb(ctx, paintSize, seed, options);
  const url = canvas.toDataURL("image/png");
  dataURLCache.set(key, url);
  return url;
}
