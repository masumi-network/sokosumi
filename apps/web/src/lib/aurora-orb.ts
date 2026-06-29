/**
 * aurora-orb — deterministic generative "aurora orb" avatars.
 *
 * Same seed string → identical orb, forever, with no storage. A glowing
 * gradient sphere with slow-drifting color clouds; reads premium at large
 * sizes and stays legible down to ~24px because the "detail" is large soft
 * gradients, not fine particles.
 *
 * Ported verbatim from the reference `aurora-orb.js` (same math → identical
 * output) into a typed, tree-shakeable module. Browser-only: `draw`/`mount`/
 * `toDataURL` need a `<canvas>` 2D context (and `document` for `toDataURL`).
 *
 * Performance: `mount()` runs ONE rAF loop per canvas — use it only for the
 * few orbs actually shown large (the user's hero avatar). For lists/feeds use
 * `toDataURL(seed, size)` (cached) in an `<img>`. devicePixelRatio is capped
 * at 3.
 */

export interface OrbLobe {
  hue: number;
  ang: number;
  dist: number;
  rad: number;
  sp: number;
  dir: number;
  al: number;
  bsp: number;
  bph: number;
}

export interface OrbParams {
  h0: number;
  h1: number;
  h2: number;
  hues: number[];
  lobes: OrbLobe[];
  light: number;
  rot: number;
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

export function params(seed: string): OrbParams {
  const r = mulberry32(xmur3(String(seed))());
  // Curated cool / jewel hue bands (teal → rose, brand-adjacent around violet).
  // Skips the muddy yellow-green-olive-brown range so every seed reads premium
  // rather than ugly, while still giving each user a distinct colour.
  const BANDS: Array<[number, number]> = [
    [168, 198], // teal → cyan
    [200, 232], // sky → blue
    [232, 264], // indigo → violet (Wisteria-adjacent)
    [264, 296], // violet → purple
    [296, 330], // magenta → fuchsia
    [330, 352], // rose
  ];
  const band = BANDS[Math.floor(r() * BANDS.length)] ?? BANDS[2]!;
  const h0 = band[0] + r() * (band[1] - band[0]);
  // Gentle analogous companions (a small forward drift) so the orb stays a
  // cohesive jewel instead of clashing with a hard complement.
  const h1 = (h0 + 16 + r() * 24) % 360;
  const h2 = (h0 + 34 + r() * 34) % 360;
  const hues = [h0, h1, h2];
  const lobes: OrbLobe[] = [];
  const n = 3 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    lobes.push({
      hue: hues[Math.floor(r() * hues.length)]!,
      ang: r() * 6.2832,
      dist: 0.1 + r() * 0.42,
      rad: 0.45 + r() * 0.5,
      sp: 0.3 + r() * 0.7,
      dir: r() < 0.5 ? 1 : -1,
      al: 0.42 + r() * 0.34,
      bsp: 0.45 + r() * 0.8,
      bph: r() * 6.2832,
    });
  }
  return {
    h0,
    h1,
    h2,
    hues,
    lobes,
    light: r() * 6.2832,
    rot: (0.04 + r() * 0.14) * (r() < 0.5 ? 1 : -1),
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
  const la = p.light + t * p.rot * 1.1;
  const lx = cx + Math.cos(la) * R * 0.3;
  const ly = cy + Math.sin(la) * R * 0.3;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, S, S);

  const halo = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R * 1.5);
  halo.addColorStop(0, `hsla(${p.h0},80%,55%,0.28)`);
  halo.addColorStop(1, `hsla(${p.h0},80%,55%,0)`);
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, S, S);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, 6.2832);
  ctx.clip();

  const base = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  base.addColorStop(0, `hsl(${p.h0},72%,50%)`);
  base.addColorStop(1, `hsl(${p.h2},68%,40%)`);
  ctx.fillStyle = base;
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

  ctx.globalCompositeOperation = "screen";
  for (const b of p.lobes) {
    const a = b.ang + t * b.sp * b.dir;
    const dd = b.dist * (1 + 0.34 * Math.sin(t * b.bsp + b.bph));
    const bx = cx + Math.cos(a) * R * dd;
    const by = cy + Math.sin(a) * R * dd;
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, R * b.rad);
    g.addColorStop(0, `hsla(${Math.round(b.hue)},82%,68%,${b.al})`);
    g.addColorStop(1, `hsla(${Math.round(b.hue)},82%,68%,0)`);
    ctx.fillStyle = g;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  }

  ctx.globalCompositeOperation = "source-over";
  const shade = ctx.createRadialGradient(lx, ly, R * 0.1, cx, cy, R * 1.05);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(0.7, "rgba(10,4,24,0)");
  shade.addColorStop(1, "rgba(8,3,20,0.66)");
  ctx.fillStyle = shade;
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

  ctx.globalCompositeOperation = "screen";
  const pulse = 0.5 + 0.22 * Math.sin(t * p.pulse);
  const hl = ctx.createRadialGradient(lx, ly, 0, lx, ly, R * 0.6);
  hl.addColorStop(0, `hsla(${p.h0},100%,92%,${0.5 * pulse + 0.25})`);
  hl.addColorStop(1, `hsla(${p.h0},100%,92%,0)`);
  ctx.fillStyle = hl;
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  ctx.restore();

  ctx.globalCompositeOperation = "source-over";
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, 6.2832);
  ctx.lineWidth = Math.max(1, S * 0.012);
  const rim = ctx.createLinearGradient(lx - R, ly - R, cx + R, cy + R);
  rim.addColorStop(0, `hsla(${p.h0},90%,90%,0.5)`);
  rim.addColorStop(0.5, `hsla(${p.h0},80%,80%,0.05)`);
  rim.addColorStop(1, `hsla(${p.h2},70%,60%,0.15)`);
  ctx.strokeStyle = rim;
  ctx.stroke();
}

/**
 * The pre-setup "placeholder" orb: a luminous mother-of-pearl sphere whose
 * full-spectrum iridescence sweeps continuously — it never settles on one
 * colour, so it reads as "unset / searching" until the user picks their
 * committed orb. Heavily animated: a drifting pearl tint, six orbiting spectral
 * flecks, two counter-rotating nacre sheen bands, a travelling refracted
 * spectrum arc-ring, plus a pulsing specular highlight and an iridescent rim.
 *
 * Pure function of (ctx, S, t) — no seed, no module state. From the
 * design-panel winner ("opal-nacre") with the arc-ring grafted from the
 * runner-up ("prism-energy-core") for an extra motion layer legible at ~20px.
 */
export function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  S: number,
  t: number,
): void {
  const cx = S / 2;
  const cy = S / 2;
  const R = S * 0.46;
  const TAU = 6.2832;

  // Master light point — orbits slowly, drives shading, highlight and rim.
  const la = t * 0.5;
  const lx = cx + Math.cos(la) * R * 0.34;
  const ly = cy + Math.sin(la) * R * 0.34;

  // Spectrum travel: the whole hue wheel sweeps continuously so the orb never
  // settles on one colour → reads as "unset / searching", not a committed orb.
  const spectrum = (t * 30) % 360;

  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, S, S);

  // ── soft outer halo / glow — pale iridescent, hue slowly breathing ──────────
  const haloHue = (spectrum + 40 * Math.sin(t * 0.6)) % 360;
  const halo = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R * 1.5);
  halo.addColorStop(0, `hsla(${haloHue},75%,80%,0.34)`);
  halo.addColorStop(0.5, `hsla(${(haloHue + 120) % 360},70%,78%,0.14)`);
  halo.addColorStop(1, `hsla(${haloHue},75%,80%,0)`);
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, S, S);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, TAU);
  ctx.clip();

  // ── pale pearl body — luminous off-white, faint cool→warm tint that drifts ──
  const tilt = la * 0.6;
  const gx = Math.cos(tilt) * R * 0.7;
  const gy = Math.sin(tilt) * R * 0.7;
  const base = ctx.createLinearGradient(cx - gx, cy - gy, cx + gx, cy + gy);
  base.addColorStop(0, `hsl(${(spectrum + 200) % 360},50%,88%)`);
  base.addColorStop(0.5, `hsl(${(spectrum + 60) % 360},32%,94%)`);
  base.addColorStop(1, `hsl(${(spectrum + 330) % 360},48%,86%)`);
  ctx.fillStyle = base;
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

  // ── iridescent flecks: screen-blended spectral lobes orbiting the centre ────
  ctx.globalCompositeOperation = "screen";
  const N = 6;
  for (let i = 0; i < N; i++) {
    const phase = (i / N) * TAU;
    const dir = i % 2 === 0 ? 1 : -1;
    const a = phase + t * (0.4 + 0.09 * i) * dir;
    const dd =
      (0.18 + 0.3 * (i % 3) * 0.5) *
      (1 + 0.36 * Math.sin(t * (0.75 + 0.16 * i) + phase));
    const bx = cx + Math.cos(a) * R * dd;
    const by = cy + Math.sin(a) * R * dd;
    const hue = (spectrum + (i / N) * 360) % 360;
    const al = 0.42 + 0.16 * Math.sin(t * 1.4 + phase);
    const rad = 0.58 + 0.18 * Math.sin(t * 0.55 + phase);
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, R * rad);
    g.addColorStop(0, `hsla(${Math.round(hue)},98%,70%,${al})`);
    g.addColorStop(
      0.6,
      `hsla(${Math.round((hue + 30) % 360)},95%,68%,${al * 0.45})`,
    );
    g.addColorStop(1, `hsla(${Math.round(hue)},98%,70%,0)`);
    ctx.fillStyle = g;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  }

  // ── nacre sheen bands: two wide rotating spectral bands sweep across body ───
  for (let k = 0; k < 2; k++) {
    const ba = t * (0.65 + 0.28 * k) * (k === 0 ? 1 : -1) + k * 1.7;
    const dx = Math.cos(ba) * R;
    const dy = Math.sin(ba) * R;
    const bandHue = (spectrum + 180 * k + 90 * Math.sin(t * 0.4 + k)) % 360;
    const band = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    const ba0 = 0.13 + 0.07 * Math.sin(t * 1.1 + k * 2);
    band.addColorStop(0, `hsla(${bandHue},92%,75%,0)`);
    band.addColorStop(0.4, `hsla(${bandHue},94%,76%,${ba0})`);
    band.addColorStop(
      0.5,
      `hsla(${(bandHue + 55) % 360},97%,82%,${ba0 + 0.13})`,
    );
    band.addColorStop(0.6, `hsla(${(bandHue + 110) % 360},94%,76%,${ba0})`);
    band.addColorStop(1, `hsla(${bandHue},92%,75%,0)`);
    ctx.fillStyle = band;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  }

  // ── grafted from "prism-energy-core": one travelling refracted spectrum
  //    arc-ring. A screen-blended stroked circle whose rainbow sweeps and whose
  //    centre gently orbits — a distinct extra motion layer that stays legible
  //    even at ~20px (thicker stroke than prism's pair of thin rings). ─────────
  {
    const rr = R * 0.7 * (1 + 0.05 * Math.sin(t * 1.6));
    const ax = cx + Math.cos(t * 0.9) * R * 0.07;
    const ay = cy + Math.sin(t * 0.9) * R * 0.07;
    const ah = (t * 55 + 120) % 360;
    const arc = ctx.createLinearGradient(ax - rr, ay - rr, ax + rr, ay + rr);
    arc.addColorStop(0, `hsla(${ah},95%,72%,0)`);
    arc.addColorStop(0.35, `hsla(${(ah + 40) % 360},95%,74%,0.42)`);
    arc.addColorStop(0.5, `hsla(${(ah + 80) % 360},98%,84%,0.6)`);
    arc.addColorStop(0.65, `hsla(${(ah + 120) % 360},95%,74%,0.42)`);
    arc.addColorStop(1, `hsla(${ah},95%,72%,0)`);
    ctx.strokeStyle = arc;
    ctx.lineWidth = Math.max(2, S * 0.018);
    ctx.beginPath();
    ctx.arc(ax, ay, rr, 0, TAU);
    ctx.stroke();
  }

  // ── sphere shading: darken toward the rim away from the light ───────────────
  ctx.globalCompositeOperation = "source-over";
  const shade = ctx.createRadialGradient(lx, ly, R * 0.1, cx, cy, R * 1.05);
  shade.addColorStop(0, "rgba(20,16,40,0)");
  shade.addColorStop(0.62, "rgba(18,14,38,0)");
  shade.addColorStop(1, "rgba(24,16,46,0.42)");
  ctx.fillStyle = shade;
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

  // ── bright specular highlight, pulsing, faintly tinted by the spectrum ──────
  ctx.globalCompositeOperation = "screen";
  const pulse = 0.5 + 0.3 * Math.sin(t * 1.8);
  const hlHue = (spectrum + 60) % 360;
  const hl = ctx.createRadialGradient(lx, ly, 0, lx, ly, R * 0.62);
  hl.addColorStop(0, `hsla(${hlHue},65%,99%,${0.55 * pulse + 0.3})`);
  hl.addColorStop(0.5, `hsla(${(hlHue + 40) % 360},85%,90%,${0.2 * pulse})`);
  hl.addColorStop(1, `hsla(${hlHue},65%,99%,0)`);
  ctx.fillStyle = hl;
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  ctx.restore();

  // ── iridescent rim: thin stroke, bright where the light is, hue travelling ──
  ctx.globalCompositeOperation = "source-over";
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, TAU);
  ctx.lineWidth = Math.max(1, S * 0.012);
  const rim = ctx.createLinearGradient(lx - R, ly - R, cx + R, cy + R);
  rim.addColorStop(0, `hsla(${(spectrum + 30) % 360},92%,90%,0.7)`);
  rim.addColorStop(0.5, `hsla(${(spectrum + 180) % 360},88%,85%,0.1)`);
  rim.addColorStop(1, `hsla(${(spectrum + 300) % 360},85%,80%,0.38)`);
  ctx.strokeStyle = rim;
  ctx.stroke();

  ctx.globalCompositeOperation = "source-over";
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
): void {
  const o = Math.max(0, Math.min(1.4, f.open));
  if (o <= 0.001) return;
  const wake = Math.min(1, o); // shape branches fade in via this on appear
  const cx = S / 2;
  const cy = S / 2;
  const R = S * 0.46;
  const eyeDx = R * 0.33;
  const eyeW = R * 0.24;
  const eyeH = R * 0.46;
  const baseY = cy - R * 0.05;
  const lookX = f.gazeX * R;
  const lookY = f.gazeY * R - f.lift * eyeH * 0.22;
  const minH = eyeW * 0.16;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.shadowColor = "rgba(0,0,0,0.28)";
  ctx.shadowBlur = S * 0.018;
  const ink = "rgba(10,8,16,0.95)";
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineCap = "round";

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
  let speedVal = speed;

  // ── Face (eyes) state — evolved each frame so the behaviour reads natural ──
  let faceExpr: OrbExpression | null = opts.expression ?? null; // shape drawn now
  let targetExpr: OrbExpression | null = opts.expression ?? null; // desired
  let curOpen = faceExpr ? eyeOpen(faceExpr) : 1; // eased openness
  let curLift = faceExpr ? eyeLift(faceExpr) : 0; // eased upward gaze
  let wake = faceExpr ? 1 : 0; // 0..1 — fades eyes in on appear, out on hide
  let blinkP = -1; // -1 = open; 0..1 = mid-blink
  let nextBlinkIn = 0.5 + Math.random() * 1.2;
  let lastTt = 0;
  const nextBlinkInterval = () =>
    Math.random() < 0.1 ? 0.18 : 3.4 * (0.6 + Math.random() * 0.9);

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

      drawEyes(ctx, canvas.width, faceExpr, {
        blink,
        open: curOpen * wake,
        lift: curLift,
        gazeX,
        gazeY,
      });
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
  draw(ctx, c.width, params(seed), 0.6);
  if (expression) {
    drawEyes(ctx, c.width, expression, {
      blink: 1,
      open: eyeOpen(expression),
      lift: eyeLift(expression),
      gazeX: 0,
      gazeY: 0,
    });
  }
  const url = c.toDataURL("image/png");
  dataUrlCache.set(key, url);
  return url;
}

// ── seed helpers (uniqueness comes from the per-user `userId` in the seed) ────

/** The default orb seed for a user — deterministic + unique per user. */
export function defaultOrbSeed(userId: string): string {
  return `${userId}:0`;
}

/** Candidate seeds for the "pick your orb" selector (all unique to the user). */
export function orbCandidateSeeds(userId: string, count = 6): string[] {
  return Array.from({ length: count }, (_, i) => `${userId}:${i}`);
}
