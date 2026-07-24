import { MODE_DRAWS, type OrbState, resolvePreset } from "thinking-orbs";

import { drawEyes, type OrbExpression, params } from "@/lib/aurora-orb";

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

  ctx.clearRect(0, 0, size, size);
  MODE_DRAWS[mode](ctx, size, t, dark, opts);

  // One material: the same radial body gradient the solid discs use
  // (light point at 38%/30%), applied to every dot. Exception: the
  // porcelain "unset identity" — white dots would vanish on light
  // backgrounds, so it keeps the painter's native neutral ink (already
  // theme-aware via `dark`), which doubles as a nice "no colour chosen
  // yet" signal.
  if (paletteId !== "porcelain") {
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
    drawEyes(
      ctx,
      size,
      expression,
      { blink: eyesOpen, open: eyesOpen, lift: 0, gazeX, gazeY },
      undefined,
      dark ? "rgba(240,238,248,0.95)" : paint.ink,
    );
  }
}

/**
 * Below-preset sizes render at the nearest hand-tuned preset size and let
 * CSS downscale — the 64 tuning survives shrinking to avatar slots far
 * better than linearly shrunken dot radii survive direct painting.
 */
export function dottedPaintSize(size: number): number {
  if (size <= 26) return 20;
  return Math.max(size, 64);
}

/**
 * Static dotted orb as a PNG data URL — the cheap path for the many
 * non-animated surfaces (message rows, task comments, landing). Rendered
 * at 2x for crispness regardless of devicePixelRatio.
 */
export function dottedOrbDataURL(
  seed: string,
  size: number,
  options: Omit<DottedOrbDrawOptions, "t" | "eyesOpen" | "gazeX" | "gazeY">,
): string {
  const scale = 2;
  const paintSize = dottedPaintSize(size);
  const canvas = document.createElement("canvas");
  canvas.width = paintSize * scale;
  canvas.height = paintSize * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.scale(scale, scale);
  drawDottedOrb(ctx, paintSize, seed, options);
  return canvas.toDataURL("image/png");
}
