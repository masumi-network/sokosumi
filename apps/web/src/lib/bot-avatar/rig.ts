import type { AvatarState } from "@sokosumi/soko-bot";

/** Where the pointer is relative to the avatar, each axis in -1..1. */
export interface Look {
  x: number;
  y: number;
}

export interface Pose {
  yaw: number;
  pitch: number;
  roll: number;
  lift: number;
  sy: number;
  gx: number;
  gy: number;
  blink: number;
  squint: number;
}

/**
 * Exact Euclidean distance transform (Felzenszwalb), in place on a W×W grid.
 * With `site`, also writes each pixel's nearest zero pixel (as y * W + x).
 */
export function edt(f: Float64Array, W: number, site?: Int32Array): void {
  const INF = 1e20;
  const z = new Float64Array(W + 1);
  const v = new Int32Array(W);
  const d = new Float64Array(W);
  const g = new Float64Array(W);
  const arg = new Int32Array(W);
  const row = site ? new Int32Array(W * W) : null;
  const pass = (
    get: (n: number) => number,
    set: (n: number, val: number, a: number) => void,
  ) => {
    for (let n = 0; n < W; n++) g[n] = get(n);
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < W; q++) {
      let s: number;
      do {
        const p = v[k] as number;
        s =
          ((g[q] as number) + q * q - ((g[p] as number) + p * p)) /
          (2 * q - 2 * p);
      } while (s <= (z[k] as number) && --k >= 0);
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < W; q++) {
      while ((z[k + 1] as number) < q) k++;
      const p = v[k] as number;
      d[q] = (q - p) ** 2 + (g[p] as number);
      arg[q] = p;
    }
    for (let n = 0; n < W; n++) set(n, d[n] as number, arg[n] as number);
  };
  for (let x = 0; x < W; x++)
    pass(
      (y) => f[y * W + x] as number,
      (y, val, a) => {
        f[y * W + x] = val;
        if (row) row[y * W + x] = a;
      },
    );
  for (let y = 0; y < W; y++)
    pass(
      (x) => f[y * W + x] as number,
      (x, val, a) => {
        f[y * W + x] = val;
        if (site && row) site[y * W + x] = (row[y * W + a] as number) * W + a;
      },
    );
  for (let i = 0; i < f.length; i++) f[i] = Math.sqrt(f[i] as number);
}

// ---- motion (deterministic, after open-bot-avatar's motion.ts) ----

export function noise(seed: number, n: number): number {
  let x = (seed ^ Math.imul(n | 0, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function blinkAt(seed: number, t: number): number {
  const SLOT = 4.2;
  const DUR = 0.19;
  const slot = Math.floor(t / SLOT);
  let c = 0;
  for (const s of [slot - 1, slot]) {
    const start = s * SLOT + 0.5 + noise(seed, s * 2) * 2.9;
    const starts =
      noise(seed, s * 2 + 1) > 0.8 ? [start, start + 0.34] : [start];
    for (const b of starts) {
      const u = (t - b) / DUR;
      if (u > 0 && u < 1) c = Math.max(c, Math.sin(Math.PI * u));
    }
  }
  return c;
}

/** The head's pose at time `t` seconds for a state; `look` pulls it toward the pointer. */
export function pose(
  seed: number,
  t: number,
  state: AvatarState,
  look: Look | null,
): Pose {
  const ph = noise(seed, 99) * 6.28;
  const p: Pose = {
    yaw: 0.07 * Math.sin(t * 0.55 + ph),
    pitch: 0.05 * Math.sin(t * 0.7 + ph * 2),
    roll: 0,
    lift: -0.006 * Math.sin(t * 1.6 + ph),
    sy: 1 + 0.008 * Math.sin(t * 1.6 + ph),
    gx: 0.35 * Math.sin(t * 0.37 + ph),
    gy: 0,
    blink: blinkAt(seed, t),
    squint: 0,
  };
  if (state === "thinking") {
    p.yaw = -0.18 + 0.04 * Math.sin(t * 0.9);
    p.pitch = -0.12;
    p.roll = -2.5;
    p.gx = 0.85;
    p.gy = -0.9;
  } else if (state === "done") {
    // A little celebration: quick hops, happy squint, a wiggle.
    const hop = Math.abs(Math.sin(t * 4.2));
    p.lift = -0.03 * hop;
    p.sy = 1 - 0.035 * (1 - hop);
    p.squint = 0.55;
    p.roll = 3 * Math.sin(t * 2.1);
  } else if (state === "working") {
    // Head down over the work, eyes reading left to right, small quick nods.
    p.yaw = 0.05 * Math.sin(t * 0.8 + ph);
    p.pitch = 0.1 + 0.025 * Math.abs(Math.sin(t * 3.1));
    p.gx = 0.55 * Math.sin(t * 1.4);
    p.gy = 0.75;
    p.squint = 0.22;
  } else if (state === "needs_you") {
    // Faces you, eyes wide, and hops every couple of seconds to get attention.
    const ph2 = (t % 2.4) / 2.4;
    const hop = ph2 < 0.22 ? Math.sin((ph2 / 0.22) * Math.PI) : 0;
    p.yaw = 0.02 * Math.sin(t * 0.6);
    p.pitch = -0.04;
    p.lift = -0.045 * hop;
    p.sy = 1 + 0.02 * hop - (ph2 > 0.22 && ph2 < 0.3 ? 0.03 : 0);
    p.roll = 2.5 * hop * Math.sin(t * 9);
    p.gx = 0;
  } else if (state === "error") {
    // A slow "oh no" head shake now and then, looking down.
    const ph3 = (t % 4) / 4;
    const shake = ph3 < 0.35 ? Math.sin((ph3 / 0.35) * Math.PI) : 0;
    p.yaw = 0.16 * shake * Math.sin(t * 9);
    p.pitch = 0.09;
    p.roll = -2;
    p.gx = 0;
    p.gy = 0.6;
    p.squint = 0.3;
  } else if (state === "sleeping") {
    // Eyes shut, head drooped and tilted, slow deep breaths.
    p.yaw = 0.03 * Math.sin(t * 0.3 + ph);
    p.pitch = 0.13;
    p.roll = 5;
    p.lift = -0.01 * Math.sin(t * 0.9);
    p.sy = 1 + 0.02 * Math.sin(t * 0.9);
    p.blink = 1;
    p.gx = 0;
    p.gy = 0.4;
  }
  if (look && state !== "sleeping") {
    p.yaw += 0.32 * look.x;
    p.pitch += 0.2 * -look.y;
    p.gx = p.gx * 0.3 + look.x;
    p.gy = p.gy * 0.3 + look.y;
  }
  return p;
}
