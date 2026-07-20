/**
 * aurora-orb — deterministic matte-disc avatars ("porcelain" orbs).
 *
 * Same seed string → identical orb, forever, with no storage. A clean matte
 * sphere in one colour from a curated palette (13 hues × pastel/jewel tiers
 * plus porcelain-white and sumi-ink anchors), with a soft top-light, hairline
 * rim, and a faint tinted halo. The colour carries identity; the seeded face
 * traits keep two coworkers with the same colour from looking identical.
 *
 * Seed format: `orb:<paletteId>` or `orb:<paletteId>:<salt>` — the palette id
 * picks the colour, the full seed string drives the face traits. Any other
 * (legacy/arbitrary) seed hashes deterministically onto a tinted palette
 * entry, so pre-palette seeds keep a stable look forever.
 *
 * Browser-only: `draw`/`mount`/`toDataURL` need a `<canvas>` 2D context (and
 * `document` for `toDataURL`).
 *
 * Performance: `mount()` runs ONE rAF loop per canvas — use it only for the
 * few orbs actually shown large (the user's hero avatar). For lists/feeds use
 * `toDataURL(seed, size)` (cached) in an `<img>`. devicePixelRatio is capped
 * at 3.
 */

// ── curated palette ──────────────────────────────────────────────────────────

export interface OrbPaletteEntry {
  /** Stable id, persisted inside seeds — never rename. */
  id: string;
  name: string;
  tier: "anchor" | "pastel" | "jewel";
  /** Base hue; null for the neutral anchors. */
  hue: number | null;
}

const HUES: Array<[string, number]> = [
  ["rose", 350],
  ["coral", 18],
  ["amber", 42],
  ["emerald", 152],
  ["teal", 172],
  ["cyan", 190],
  ["sky", 207],
  ["blue", 225],
  ["indigo", 248],
  ["wisteria", 264],
  ["purple", 283],
  ["magenta", 308],
  ["pink", 330],
];

/**
 * The choosable palette, in display order: anchors first, then the pastel
 * tier, then the jewel tier. ~28 colours = plenty of variety between
 * coworkers while one shading recipe keeps them a family.
 */
export const ORB_PALETTE: OrbPaletteEntry[] = [
  { id: "porcelain", name: "Porcelain", tier: "anchor", hue: null },
  { id: "ink", name: "Ink", tier: "anchor", hue: null },
  ...HUES.map(
    ([name, hue]): OrbPaletteEntry => ({
      id: `pastel-${name}`,
      name: `Pastel ${name}`,
      tier: "pastel",
      hue,
    }),
  ),
  ...HUES.map(
    ([name, hue]): OrbPaletteEntry => ({
      id: `jewel-${name}`,
      name: `Jewel ${name}`,
      tier: "jewel",
      hue,
    }),
  ),
];

const PALETTE_BY_ID = new Map(ORB_PALETTE.map((e) => [e.id, e]));
/** Tinted entries only — the pool legacy/arbitrary seeds hash onto. */
const TINTED = ORB_PALETTE.filter((e) => e.tier !== "anchor");

/** Resolved paint recipe for one palette entry. */
interface OrbPaint {
  /** Radial body gradient, light → mid → edge. */
  stops: [string, string, string];
  /** Hairline rim stroke. */
  rim: string;
  /** Soft halo colour (alpha baked in). */
  halo: string;
  /** Face/eyes ink on this body. */
  ink: string;
}

function paintFor(entry: OrbPaletteEntry): OrbPaint {
  const darkInk = "rgba(10,8,16,0.95)";
  if (entry.id === "ink") {
    return {
      stops: ["#3a3a3e", "#1c1c1f", "#101013"],
      rim: "rgba(250,250,250,0.14)",
      halo: "rgba(250,250,250,0.07)",
      ink: "rgba(250,250,250,0.95)",
    };
  }
  if (entry.id === "porcelain" || entry.hue === null) {
    return {
      stops: ["#ffffff", "#f2f2f4", "#e2e2e8"],
      rim: "rgba(10,10,10,0.10)",
      halo: "rgba(130,130,150,0.10)",
      ink: darkInk,
    };
  }
  const h = entry.hue;
  const [l0, l1, l2, s] =
    entry.tier === "pastel" ? [86, 76, 68, 70] : [74, 62, 52, 72];
  return {
    stops: [
      `hsl(${h} ${s}% ${l0}%)`,
      `hsl(${h} ${s}% ${l1}%)`,
      `hsl(${h} ${s - 6}% ${l2}%)`,
    ],
    rim: `hsla(${h}, 55%, 30%, 0.18)`,
    halo: `hsla(${h}, 80%, 60%, 0.15)`,
    ink: darkInk,
  };
}

export interface OrbParams {
  /** The resolved palette entry this seed maps to. */
  paletteId: string;
  paint: OrbPaint;
  /** Seeded initial light angle — tiny per-orb variation in the sheen. */
  light: number;
  /** Seeded sheen breathing rate. */
  pulse: number;
}

export interface MountOptions {
  seed?: string;
  /** Run the rAF animation loop. Default true. */
  animate?: boolean;
  /** Animation speed multiplier (e.g. 0.5 calm, 1.5 lively). Default 1. */
  speed?: number;
  /** Fallback CSS size (px) when the canvas has no measured width. */
  size?: number;
  /**
   * Render the seedless animated "placeholder" orb (pre-setup state) via
   * `drawPlaceholder` instead of the seed's committed orb. Ignores `seed`.
   */
  placeholder?: boolean;
  /**
   * When set, draws the orb's glowing eyes with this expression on top of the
   * body. Null/undefined → no eyes. Update live via `MountHandle.setExpression`.
   */
  expression?: OrbExpression | null;
}

interface OrbFaceTraits {
  eyeSpacing: number;
  eyeWidth: number;
  eyeHeight: number;
  eyeYOffset: number;
  eyeTilt: number;
  blinkScale: number;
  gazeScale: number;
}

export interface MountHandle {
  stop(): void;
  params: OrbParams;
  /** Swap the eyes' expression live (or pass null to hide them). */
  setExpression(expression: OrbExpression | null): void;
  /** Change the animation speed live, without a phase jump. */
  setSpeed(speed: number): void;
  /**
   * Briefly flash a transient expression (e.g. a wink on task-done, surprise on
   * a new message) for `ms`, then ease back to the current resting expression.
   * Overrides any spontaneous gesture in flight.
   */
  pulse(expression: OrbExpression, ms?: number): void;
}

function dpr(): number {
  return Math.min(
    typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
    3,
  );
}

/**
 * Supersample the live canvas: render the backing store ~2× the physical pixel
 * size so small vector features — the eyes especially — downscale with
 * anti-aliasing instead of sitting 1:1 on the pixel grid and looking soft. The
 * static `toDataURL` path already over-renders via its `size > display`
 * convention, so this only applies to the animated `mount` path.
 */
const ORB_SUPERSAMPLE = 2;
/** Bound the backing dimension so a large hero on a high-DPI screen stays sane. */
const ORB_MAX_BACKING = 1024;

// ── seeded PRNG ──────────────────────────────────────────────────────────────

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function faceTraits(seed: string, placeholder: boolean): OrbFaceTraits {
  const r = mulberry32(xmur3(`${placeholder ? "placeholder" : seed}:face`)());
  return {
    eyeSpacing: 0.9 + r() * 0.2,
    eyeWidth: 0.9 + r() * 0.18,
    eyeHeight: 0.9 + r() * 0.2,
    eyeYOffset: -0.035 + r() * 0.07,
    eyeTilt: -0.08 + r() * 0.16,
    blinkScale: 0.86 + r() * 0.34,
    gazeScale: 0.78 + r() * 0.44,
  };
}

/** Resolve a seed to its palette entry (see the seed format in the header). */
function paletteEntryForSeed(seed: string): OrbPaletteEntry {
  if (seed.startsWith("orb:")) {
    const id = seed.split(":")[1] ?? "";
    const entry = PALETTE_BY_ID.get(id);
    if (entry) return entry;
  }
  // Legacy/arbitrary seed — hash deterministically onto a tinted entry so
  // pre-palette avatars keep a stable colour forever.
  const r = mulberry32(xmur3(String(seed))());
  return TINTED[Math.floor(r() * TINTED.length)] ?? TINTED[0]!;
}

export function params(seed: string): OrbParams {
  const entry = paletteEntryForSeed(seed);
  const r = mulberry32(xmur3(`${seed}:paint`)());
  return {
    paletteId: entry.id,
    paint: paintFor(entry),
    light: r() * 6.2832,
    pulse: 0.8 + r() * 1.2,
  };
}

export function draw(
  ctx: CanvasRenderingContext2D,
  S: number,
  p: OrbParams,
  t: number,
): void {
  const cx = S / 2;
  const cy = S / 2;
  const R = S * 0.46;
  const TAU = 6.2832;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, S, S);

  // Soft tinted halo — the "glow on dark" from the approved recipe; on light
  // surfaces it reads as a faint tint shadow. Alpha lives in the colour.
  const halo = ctx.createRadialGradient(cx, cy, R * 0.85, cx, cy, R * 1.4);
  halo.addColorStop(0, p.paint.halo);
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, S, S);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, TAU);
  ctx.clip();

  // Matte body — one radial top-light (the CSS `circle at 38% 30%` recipe).
  const bx = cx - R * 0.24;
  const by = cy - R * 0.4;
  const body = ctx.createRadialGradient(bx, by, 0, bx, by, R * 1.7);
  body.addColorStop(0, p.paint.stops[0]);
  body.addColorStop(0.55, p.paint.stops[1]);
  body.addColorStop(1, p.paint.stops[2]);
  ctx.fillStyle = body;
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

  // Whisper of life: a slow-breathing specular sheen near the light point.
  // Subtle enough that a static frame still reads as a flat matte disc.
  const la = p.light + t * 0.15;
  const sx = bx + Math.cos(la) * R * 0.08;
  const sy = by + Math.sin(la) * R * 0.08;
  const sa = 0.1 + 0.04 * Math.sin(t * p.pulse);
  const sheen = ctx.createRadialGradient(sx, sy, 0, sx, sy, R * 0.75);
  sheen.addColorStop(0, `rgba(255,255,255,${sa})`);
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  ctx.restore();

  // Hairline rim.
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, TAU);
  ctx.lineWidth = Math.max(1, S * 0.01);
  ctx.strokeStyle = p.paint.rim;
  ctx.stroke();
}

/** Fixed params for the pre-setup porcelain placeholder. */
const PLACEHOLDER_PARAMS: OrbParams = {
  paletteId: "porcelain",
  paint: paintFor(PALETTE_BY_ID.get("porcelain")!),
  light: 0.8,
  pulse: 1.1,
};

/**
 * The pre-setup "placeholder" orb: the porcelain-white matte disc — the
 * neutral "unset" state until the user picks their committed colour. Same
 * renderer as the committed orbs, so the whole family matches.
 *
 * Pure function of (ctx, S, t) — no seed, no module state.
 */
export function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  S: number,
  t: number,
): void {
  draw(ctx, S, PLACEHOLDER_PARAMS, t);
}

/** The orb's emotional state, expressed through its eyes. */
export type OrbExpression =
  | "idle"
  | "happy"
  | "content"
  | "curious"
  | "listening"
  | "thinking"
  | "focused"
  | "surprised"
  | "wink"
  | "sleeping";

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Per-expression resting eye openness (drives the eased pill height). */
function eyeOpen(expr: OrbExpression): number {
  return expr === "listening" ? 1.14 : expr === "thinking" ? 0.85 : 1;
}

/** Per-expression upward gaze (0 = level, 1 = glancing up). */
function eyeLift(expr: OrbExpression): number {
  if (expr === "thinking") return 0.5;
  if (expr === "curious") return 0.16;
  if (expr === "surprised") return 0.06;
  return 0;
}

/** Per-frame eye drive — the mount loop computes blink / gaze / fades. */
interface EyeFrame {
  /** 0 = mid-blink (closed), 1 = fully open. */
  blink: number;
  /** Overall openness scale (resting openness × wake-in/out fade). */
  open: number;
  /** Upward gaze, 0..1. */
  lift: number;
  /** Gaze offset as a fraction of the orb radius. */
  gazeX: number;
  gazeY: number;
}

/**
 * Draws the orb's glowing "eyes" on top of the body — the layer that turns an
 * orb into a character. This is a pure renderer: the *behaviour* (organic
 * blink, subtle gaze, eased transitions, wake in/out) is computed by the mount
 * loop and handed in via `EyeFrame`, so the face stays crisp across sizes and
 * the timing reads as natural rather than mechanical.
 *
 *   idle / listening / thinking  pill eyes (openness + upward gaze differ)
 *   happy                        upward "^ ^" arcs — a smile in the eyes
 *   sleeping                     closed lines
 */
export function drawEyes(
  ctx: CanvasRenderingContext2D,
  S: number,
  expr: OrbExpression,
  f: EyeFrame,
  traits: OrbFaceTraits = faceTraits("orb", false),
  /** Face colour for the current body — dark on light discs, light on ink. */
  ink = "rgba(10,8,16,0.95)",
): void {
  const o = Math.max(0, Math.min(1.4, f.open));
  if (o <= 0.001) return;
  const wake = Math.min(1, o); // shape branches fade in via this on appear
  const cx = S / 2;
  const cy = S / 2;
  const R = S * 0.46;
  const eyeDx = R * 0.33 * traits.eyeSpacing;
  const eyeW = R * 0.24 * traits.eyeWidth;
  const eyeH = R * 0.46 * traits.eyeHeight;
  const baseY = cy - R * (0.05 - traits.eyeYOffset);
  const lookX = f.gazeX * R * traits.gazeScale;
  const lookY = f.gazeY * R * traits.gazeScale - f.lift * eyeH * 0.22;
  const minH = eyeW * 0.16;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.shadowColor = "rgba(0,0,0,0.28)";
  ctx.shadowBlur = S * 0.018;
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineCap = "round";
  ctx.translate(cx, cy);
  ctx.rotate(traits.eyeTilt);
  ctx.translate(-cx, -cy);

  const pill = (ex: number, ey: number, w: number, h: number): void => {
    const hh = Math.max(minH, h);
    roundRectPath(ctx, ex - w / 2, ey - hh / 2, w, hh, w / 2);
    ctx.fill();
  };
  const round = (ex: number, ey: number, rx: number, ry: number): void => {
    ctx.beginPath();
    ctx.ellipse(ex, ey, rx, Math.max(minH * 0.6, ry), 0, 0, Math.PI * 2);
    ctx.fill();
  };
  const arc = (
    ex: number,
    ey: number,
    w: number,
    curve: number,
    lw: number,
  ): void => {
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(ex - w, ey + eyeH * 0.04);
    ctx.quadraticCurveTo(ex, ey - curve, ex + w, ey + eyeH * 0.04);
    ctx.stroke();
  };

  for (const side of [-1, 1]) {
    const ex = cx + side * eyeDx + lookX;
    const ey = baseY + lookY;

    // ── curve family ──────────────────────────────────────────────────────
    if (expr === "happy") {
      // "^ ^" smile-eyes; the curve eases flatter mid-blink so it winks.
      arc(ex, ey, eyeW * 0.82, eyeH * (0.16 + 0.22 * f.blink), eyeW * 0.5);
      continue;
    }
    if (expr === "content") {
      // a gentler, lower smile — soft + satisfied.
      arc(
        ex,
        ey + eyeH * 0.06,
        eyeW * 0.72,
        eyeH * (0.05 + 0.13 * f.blink),
        eyeW * 0.46,
      );
      continue;
    }
    if (expr === "wink") {
      // one closed-smile eye, one open pill — a playful aside.
      if (side === -1) {
        arc(ex, ey, eyeW * 0.82, eyeH * (0.16 + 0.22 * f.blink), eyeW * 0.5);
      } else {
        pill(ex, ey, eyeW, eyeH * wake * f.blink);
      }
      continue;
    }
    if (expr === "sleeping") {
      ctx.lineWidth = eyeW * 0.46;
      ctx.beginPath();
      ctx.moveTo(ex - eyeW * 0.72, ey + R * 0.05);
      ctx.lineTo(ex + eyeW * 0.72, ey + R * 0.05);
      ctx.stroke();
      continue;
    }

    // ── round family ──────────────────────────────────────────────────────
    if (expr === "surprised") {
      // big wide-open round eyes.
      round(ex, ey - eyeH * 0.04, eyeW * 0.66, eyeH * 0.66 * wake * f.blink);
      continue;
    }
    if (expr === "curious") {
      // asymmetric rounds (one raised) + a slight aside glance — inquisitive.
      const raised = side === -1;
      round(
        ex + eyeW * 0.2,
        ey + (raised ? -eyeH * 0.14 : eyeH * 0.08),
        eyeW * (raised ? 0.62 : 0.48),
        eyeH * (raised ? 0.56 : 0.42) * wake * f.blink,
      );
      continue;
    }

    // ── pill family ───────────────────────────────────────────────────────
    if (expr === "focused") {
      // wide, short, close-set level pills — determined.
      pill(
        cx + side * eyeDx * 0.84 + lookX,
        ey,
        eyeW * 1.18,
        eyeH * 0.42 * wake * f.blink,
      );
      continue;
    }
    // idle / listening / thinking — openness + upward gaze already in o / lift.
    pill(ex, ey, eyeW, eyeH * o * f.blink);
  }

  ctx.restore();
}

export function mount(
  canvas: HTMLCanvasElement,
  opts: MountOptions = {},
): MountHandle {
  const seed = opts.seed != null ? opts.seed : "orb";
  const animate = opts.animate !== false;
  const speed = opts.speed != null ? opts.speed : 1;
  const ratio = dpr();
  const p = params(seed);
  const ctx = canvas.getContext("2d");
  if (!ctx)
    return {
      stop() {},
      params: p,
      setExpression() {},
      setSpeed() {},
      pulse() {},
    };
  const size = () => {
    const css = canvas.clientWidth || opts.size || 80;
    const target = Math.min(
      Math.round(css * ratio * ORB_SUPERSAMPLE),
      ORB_MAX_BACKING,
    );
    canvas.width = target;
    canvas.height = target;
  };
  size();
  const placeholder = opts.placeholder === true;
  const traits = faceTraits(seed, placeholder);
  let speedVal = speed;

  // ── Face (eyes) state — evolved each frame so the behaviour reads natural ──
  let faceExpr: OrbExpression | null = opts.expression ?? null; // shape drawn now
  let targetExpr: OrbExpression | null = opts.expression ?? null; // desired
  let curOpen = faceExpr ? eyeOpen(faceExpr) : 1; // eased openness
  let curLift = faceExpr ? eyeLift(faceExpr) : 0; // eased upward gaze
  let wake = faceExpr ? 1 : 0; // 0..1 — fades eyes in on appear, out on hide
  let blinkP = -1; // -1 = open; 0..1 = mid-blink
  let nextBlinkIn = (0.5 + Math.random() * 1.2) * traits.blinkScale;
  let lastTt = 0;
  const nextBlinkInterval = () =>
    (Math.random() < 0.1 ? 0.18 : 3.4 * (0.6 + Math.random() * 0.9)) *
    traits.blinkScale;

  // ── Spontaneous variety — so a resting orb never sits frozen ──
  // Occasional unprompted micro-expressions while the host's expression is a
  // resting one, plus eased gaze saccades (glances) layered on the drift.
  const RESTING_EXPRS = new Set<OrbExpression>(["idle", "happy", "content"]);
  let gestureExpr: OrbExpression | null = null;
  let gestureUntil = 0; // in accumulated-time units (tt)
  // True when the active gesture is an explicit pulse() (an event like a wink on
  // task-done) rather than a spontaneous one — pulses show even over an active
  // host expression (thinking / focused), spontaneous gestures do not.
  let gestureIsPulse = false;
  let nextGestureIn = 4 + Math.random() * 5;
  let gzX = 0;
  let gzY = 0;
  let gzTargetX = 0;
  let gzTargetY = 0;
  let nextSaccadeIn = 1 + Math.random() * 2;
  const pickGesture = (): OrbExpression => {
    // Livelier orbs are a touch more expressive (and more likely to wink).
    const pool: OrbExpression[] =
      speedVal > 1.4
        ? ["curious", "curious", "surprised", "listening", "wink", "happy"]
        : ["curious", "curious", "surprised", "listening", "content"];
    return pool[Math.floor(Math.random() * pool.length)] ?? "curious";
  };

  const frame = (tt: number) => {
    const dt = Math.min(0.1, Math.max(0, tt - lastTt));
    lastTt = tt;

    if (placeholder) drawPlaceholder(ctx, canvas.width, tt);
    else draw(ctx, canvas.width, p, tt);

    // resolve the gesture (spontaneous or an explicit pulse) vs the host expr
    if (gestureExpr && tt >= gestureUntil) {
      gestureExpr = null;
      gestureIsPulse = false;
      if (blinkP < 0) blinkP = 0; // blink to mask the return to rest
    }
    const hostResting = targetExpr === null || RESTING_EXPRS.has(targetExpr);
    if (faceExpr && targetExpr && hostResting && !gestureExpr) {
      nextGestureIn -= dt;
      if (nextGestureIn <= 0) {
        gestureExpr = pickGesture();
        gestureIsPulse = false;
        gestureUntil = tt + 0.7 + Math.random() * 0.5;
        nextGestureIn = 5 + Math.random() * 7;
        if (blinkP < 0) blinkP = 0; // blink to mask the gesture in
      }
    } else if (!hostResting && !gestureIsPulse) {
      gestureExpr = null; // host is in control (thinking / focused / …)
      nextGestureIn = Math.max(nextGestureIn, 3);
    }
    const desired: OrbExpression | null = gestureExpr ?? targetExpr;

    // fade the eyes in when they appear, out when cleared
    const wakeTarget = desired ? 1 : 0;
    wake += (wakeTarget - wake) * Math.min(1, dt / 0.22);

    if (faceExpr && wake > 0.01) {
      // ease openness + upward gaze toward the target (smooth, never snaps)
      const ref = desired ?? faceExpr;
      curOpen += (eyeOpen(ref) - curOpen) * Math.min(1, dt * 6);
      curLift += (eyeLift(ref) - curLift) * Math.min(1, dt * 6);

      // organic blink — irregular timing + an occasional quick double. A blink
      // is also fired on an expression change and swaps the shape at its closed
      // point, so the face never hard-cuts between expressions.
      if (blinkP < 0) {
        nextBlinkIn -= dt;
        if (nextBlinkIn <= 0) blinkP = 0;
      } else {
        blinkP += dt / 0.16;
        if (blinkP >= 0.5 && desired && faceExpr !== desired) {
          faceExpr = desired;
        }
        if (blinkP >= 1) {
          blinkP = -1;
          nextBlinkIn = nextBlinkInterval();
        }
      }
      const blink = blinkP < 0 ? 1 : Math.abs(Math.cos(blinkP * Math.PI));

      // gaze — eased saccades (occasional glances, half the time back to centre)
      // layered with a touch of sine jitter, so the eyes wander and sometimes
      // look around rather than sit dead-centre.
      nextSaccadeIn -= dt;
      if (nextSaccadeIn <= 0) {
        if (Math.random() < 0.5) {
          gzTargetX = 0;
          gzTargetY = 0;
        } else {
          gzTargetX = (Math.random() * 2 - 1) * 0.05;
          gzTargetY = (Math.random() * 2 - 1) * 0.03;
        }
        nextSaccadeIn = 1 + Math.random() * 2.2;
      }
      gzX += (gzTargetX - gzX) * Math.min(1, dt * 4);
      gzY += (gzTargetY - gzY) * Math.min(1, dt * 4);
      const gazeX = gzX + Math.sin(tt * 0.9) * 0.006;
      const gazeY = gzY + Math.sin(tt * 0.6 + 1) * 0.004;

      drawEyes(
        ctx,
        canvas.width,
        faceExpr,
        {
          blink,
          open: curOpen * wake,
          lift: curLift,
          gazeX,
          gazeY,
        },
        traits,
        placeholder ? PLACEHOLDER_PARAMS.paint.ink : p.paint.ink,
      );
    }
  };
  let raf = 0;
  let running = true;
  // Accumulate scaled time so `setSpeed` changes the rate going forward without
  // jumping the animation's phase.
  let acc = 0;
  let lastMs = -1;
  const loop = (ms: number) => {
    if (!running) return;
    if (lastMs < 0) lastMs = ms;
    acc += ((ms - lastMs) / 1000) * speedVal;
    lastMs = ms;
    frame(acc);
    raf = window.requestAnimationFrame(loop);
  };
  if (animate) raf = window.requestAnimationFrame(loop);
  else frame(0);
  return {
    stop() {
      running = false;
      if (raf) window.cancelAnimationFrame(raf);
    },
    params: p,
    setExpression(expression: OrbExpression | null) {
      if (expression === targetExpr) return;
      if (!faceExpr && expression) {
        // first appearance — set immediately; `wake` fades it in.
        faceExpr = expression;
        curOpen = eyeOpen(expression);
        curLift = eyeLift(expression);
      } else if (faceExpr && expression && blinkP < 0) {
        // changing expression — blink to mask the shape swap.
        blinkP = 0;
      }
      targetExpr = expression ?? null;
    },
    setSpeed(s: number) {
      speedVal = s;
    },
    pulse(expression: OrbExpression, ms = 1100) {
      gestureExpr = expression;
      gestureIsPulse = true;
      gestureUntil = acc + (ms / 1000) * Math.max(0.2, speedVal);
      if (blinkP < 0) blinkP = 0;
      // keep the spontaneous scheduler from firing right after the pulse ends
      nextGestureIn = Math.max(nextGestureIn, ms / 1000 + 2);
    },
  };
}

/** Static one-frame PNG data URL for a seed. Cached by `${seed}:${size}`. */
const dataUrlCache = new Map<string, string>();

export function toDataURL(
  seed: string,
  size = 128,
  expression: OrbExpression | null = null,
): string {
  const key = `${seed}:${size}:${expression ?? ""}`;
  const cached = dataUrlCache.get(key);
  if (cached) return cached;
  const ratio = dpr();
  const c = document.createElement("canvas");
  c.width = size * ratio;
  c.height = size * ratio;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  const p = params(seed);
  draw(ctx, c.width, p, 0.6);
  if (expression) {
    const traits = faceTraits(seed, false);
    drawEyes(
      ctx,
      c.width,
      expression,
      {
        blink: 1,
        open: eyeOpen(expression),
        lift: eyeLift(expression),
        gazeX: 0,
        gazeY: 0,
      },
      traits,
      p.paint.ink,
    );
  }
  const url = c.toDataURL("image/png");
  dataUrlCache.set(key, url);
  return url;
}

// ── seed helpers ──────────────────────────────────────────────────────────────
// Colour comes from the palette id; the per-user salt keeps face traits
// unique, so two coworkers with the same colour still don't look the same.

/** Seed for a specific palette colour, salted for per-user face traits. */
export function orbSeedFor(paletteId: string, salt?: string): string {
  return salt ? `orb:${paletteId}:${salt}` : `orb:${paletteId}`;
}

/** The default orb seed for a user — a deterministic tinted palette pick. */
export function defaultOrbSeed(userId: string): string {
  const r = mulberry32(xmur3(`${userId}:default`)());
  const entry = TINTED[Math.floor(r() * TINTED.length)] ?? TINTED[0]!;
  return orbSeedFor(entry.id, userId);
}

/**
 * Candidate seeds for the "pick your colour" selector — a tight, curated
 * set: the ink anchor plus the jewel tier (porcelain is offered separately
 * by the picker as the "standard" placeholder option), salted per user.
 * The pastel tier stays in the palette for variety elsewhere without
 * overwhelming the picker.
 */
export function orbCandidateSeeds(userId: string, count?: number): string[] {
  const pool = ORB_PALETTE.filter((e) => e.id === "ink" || e.tier === "jewel");
  return pool
    .slice(0, count ?? pool.length)
    .map((e) => orbSeedFor(e.id, userId));
}
