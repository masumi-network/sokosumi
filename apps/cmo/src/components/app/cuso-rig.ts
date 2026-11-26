import type { CusoArt } from "../cuso";

/*
 * Cuso alive in the sidebar, the CMO.XYZ landing page's motion: his poses
 * come from `public/cuso/poses.svg` (made by `scripts/cuso-poses.py`). He
 * walks in with his legs drawn live so his feet stay planted, changes pose on
 * a squash and stretch that hides the cut, waves now and then while friendly,
 * wobbles like a bobblehead when his work is done, and breathes at rest.
 * Lengths below are in the walking pose's SVG units.
 */
const GROUND = 1344; // where the feet stand
const ANKLE_UP = 138; // the ankle's height above the ground on a flat shoe
const SHOE = { ankle: [875, 1200], flat: 23 } as const; // the drawn shoe is mid heel-strike, toe up 23 degrees
const HIPS = { near: [850, 1060], far: [588, 930] } as const; // where the drawing attaches each leg
const REST = {
  near: GROUND - ANKLE_UP - HIPS.near[1],
  far: GROUND - ANKLE_UP - HIPS.far[1],
};
const REACH = { near: REST.near * 1.22, far: REST.far * 1.1 }; // full leg length
const ARMS = { armL: [365, 700], armR: [880, 815] } as const;
const WAVE_PIVOT = [1265, 1190] as const; // the friendly pose's shoulder
const GAIT = {
  T: 0.44,
  stance: 0.6,
  S: 190,
  LIFT: 56,
  ARM: 24,
  LEAN: 4,
  BOB: 24,
}; // short legs: short, quick steps
const WAVE_EVERY_MS = 7000;

type Point = readonly [number, number];
type Leg = "near" | "far";

const smooth = (t: number) => t * t * (3 - 2 * t);
const wrap = (p: number) => ((p % 1) + 1) % 1;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
/** A damped spring: starts at 1, rings f times a second and dies out at rate k. */
const ring = (t: number, f: number, k: number) =>
  Math.exp(-k * t) * Math.cos(2 * Math.PI * f * t);

/**
 * A foot at phase p of its cycle: offset from its hip, height, shoe angle
 * (+ is toe down). It stays planted while the hip passes over it and rolls
 * heel to toe, then swings forward.
 */
function foot(p: number, k: number) {
  if (p < GAIT.stance) {
    const s = p / GAIT.stance;
    const roll =
      s < 0.25
        ? -14 * (1 - smooth(s / 0.25))
        : s > 0.75
          ? 26 * smooth((s - 0.75) / 0.25)
          : 0;
    const heel = s > 0.75 ? 34 * ((s - 0.75) / 0.25) ** 1.5 : 0;
    return { dx: (0.5 - s) * GAIT.S * k, up: heel * k, angle: roll * k };
  }
  const s = (p - GAIT.stance) / (1 - GAIT.stance);
  return {
    dx: (smooth(s) - 0.5) * GAIT.S * k,
    up: (34 * (1 - s) + GAIT.LIFT * Math.sin(Math.PI * s)) * k,
    angle: (26 - 40 * smooth(s)) * k,
  };
}

export interface CusoRig {
  /** Moves him into a pose: walking walks him in, any other swaps on a squash. */
  pose: (art: CusoArt) => void;
  /** A hop on the spot, when he is at rest; ignored while he moves. */
  hop: () => void;
  stop: () => void;
}

/** Brings the poses drawing `fig` to life; `shadow` is the dark spot under his feet. */
export function startCusoRig(fig: SVGSVGElement, shadow: HTMLElement): CusoRig {
  const poses = new Map<string, SVGSVGElement>();
  for (const el of fig.querySelectorAll<SVGSVGElement>("svg[data-pose]")) {
    poses.set(el.dataset.pose ?? "", el);
  }
  const part = (name: string) =>
    fig.querySelector<SVGGElement>(`[data-part="${name}"]`);
  const leg = (name: Leg) => {
    const g = fig.querySelector(`[data-leg="${name}"]`);
    return {
      tubes: [...(g?.querySelectorAll("[data-tube]") ?? [])],
      shoe: g?.querySelector("[data-shoe]") ?? null,
    };
  };
  const rig = {
    armL: part("armL"),
    armR: part("armR"),
    body: part("body"),
    wave: part("wave"),
    near: leg("near"),
    far: leg("far"),
  };
  const walkWidth = poses.get("walking")?.viewBox.baseVal.width || 1360;
  const size = () => fig.clientWidth;

  // y is a share of his box, so a hop is the same size at any stage size.
  const st = { x: 0, y: 0, rot: 0, scale: 1, squash: 0, alpha: 1 };
  let breathe = 1;
  let sway = 0;
  let shown: CusoArt | null = null;
  let target: CusoArt | null = null;
  let idle = false;
  let token = 0;
  let stopped = false;
  let raf = 0;
  let lastWave = 0;

  function render() {
    const s = st.scale * breathe;
    fig.style.transform = `translate(${st.x}px, ${st.y * size()}px) rotate(${st.rot + sway}deg) scale(${s * (1 + 0.5 * st.squash)}, ${s * (1 - st.squash)})`;
    fig.style.opacity = String(st.alpha);
    const lift = Math.min(1, Math.max(0, -st.y / 0.12));
    shadow.style.transform = `translateX(${st.x}px) scale(${st.scale * (1 - 0.45 * lift)})`;
    shadow.style.opacity = String(st.alpha * (1 - 0.5 * lift));
  }

  function show(art: CusoArt) {
    shown = art;
    for (const [name, el] of poses) {
      el.style.visibility = name === art ? "visible" : "hidden";
    }
  }

  const turn = (
    el: SVGGElement | null,
    [px, py]: Point,
    deg: number,
    pre = "",
  ) =>
    el?.setAttribute(
      "transform",
      `${pre}rotate(${deg.toFixed(2)} ${px} ${py})`,
    );

  /** Runs fn every frame until it returns false; stops early if a newer move starts. */
  function frames(fn: (dt: number) => boolean): Promise<boolean> {
    const mine = token;
    return new Promise((resolve) => {
      let last = performance.now();
      const tick = (now: number) => {
        if (stopped || mine !== token) return resolve(false);
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const more = fn(dt);
        render();
        if (!more) return resolve(true);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  function tween(
    ms: number,
    fn: (eased: number, raw: number) => void,
    ease: (t: number) => number = (t) => t,
  ) {
    let t = 0;
    return frames((dt) => {
      t = Math.min(1, t + (dt * 1000) / ms);
      fn(ease(t), t);
      return t < 1;
    });
  }

  function drawLeg(name: Leg, f: ReturnType<typeof foot>, drop: number) {
    const [hx, hipY] = HIPS[name];
    const hy = hipY + drop;
    const ax = hx + f.dx;
    const ay = GROUND - ANKLE_UP - f.up;
    const dist = Math.hypot(ax - hx, ay - hy);
    // The knee bends forward when the leg is shorter than its reach.
    const bend = Math.sqrt(Math.max(0, REACH[name] ** 2 - dist * dist)) * 0.5;
    const nx = (ay - hy) / dist;
    const ny = -(ax - hx) / dist;
    const d = `M${hx.toFixed(1)} ${hy.toFixed(1)} Q${((hx + ax) / 2 + nx * bend).toFixed(1)} ${((hy + ay) / 2 + ny * bend).toFixed(1)} ${ax.toFixed(1)} ${ay.toFixed(1)}`;
    for (const tube of rig[name].tubes) tube.setAttribute("d", d);
    rig[name].shoe?.setAttribute(
      "transform",
      `translate(${(ax - SHOE.ankle[0]).toFixed(1)} ${(ay - SHOE.ankle[1]).toFixed(1)}) rotate(${(SHOE.flat + f.angle).toFixed(2)} ${SHOE.ankle[0]} ${SHOE.ankle[1]})`,
    );
  }

  function walkPose(ph: number, k: number, dip = 0) {
    // The hip eases down through each step, lowest just after a foot lands, so steps land softly.
    const drop =
      GAIT.BOB * k * (0.5 + 0.5 * Math.cos(4 * Math.PI * (ph - 0.1))) + dip;
    drawLeg("far", foot(wrap(ph + 0.5), k), drop);
    drawLeg("near", foot(wrap(ph), k), drop);
    // He leans into the walk and rocks forward a touch at each push-off.
    const rock =
      GAIT.LEAN * k + 1.6 * k * Math.sin(4 * Math.PI * wrap(ph - 0.12));
    const upper = `translate(0 ${drop.toFixed(1)}) rotate(${rock.toFixed(2)} ${HIPS.near[0]} ${HIPS.near[1]}) `;
    rig.body?.setAttribute("transform", upper);
    // Arms swing against the legs and trail them a little.
    const swing = Math.sin(2 * Math.PI * wrap(ph - 0.08)) * GAIT.ARM * k;
    turn(rig.armR, ARMS.armR, swing, upper);
    turn(rig.armL, ARMS.armL, swing * 0.8, upper);
  }

  async function wave(cycles: number) {
    const mine = token;
    await tween(cycles * 520, (_, r) =>
      turn(
        rig.wave,
        WAVE_PIVOT,
        -12 * Math.sin(Math.PI * r) ** 0.6 * Math.sin(2 * Math.PI * cycles * r),
      ),
    );
    if (mine === token) turn(rig.wave, WAVE_PIVOT, 0);
  }

  /** He steps off, then walks in from the left and plants his feet. */
  async function walkIn() {
    token += 1;
    idle = false;
    if (shown && shown !== "walking") {
      const left = await tween(
        120,
        (t) => {
          st.alpha = 1 - t;
          st.squash = 0.06 * t;
        },
        easeOut,
      );
      if (!left) return;
    }
    const speed = (GAIT.S / (GAIT.stance * GAIT.T)) * (size() / walkWidth);
    const settle = speed * GAIT.T * 0.5; // the last half step brings his feet together
    const start = -settle - speed * 0.75;
    let x = start;
    let phase = 0.25;
    Object.assign(st, { x, y: 0, rot: 0, scale: 1, squash: 0, alpha: 0 });
    show("walking");
    walkPose(phase, 1); // before the next paint, or he flashes with his old legs
    render();
    const walked = await frames((dt) => {
      x = Math.min(-settle, x + speed * dt);
      phase += dt / GAIT.T;
      st.x = x;
      st.alpha = Math.min(1, (x - start) / (speed * 0.15));
      walkPose(phase, 1);
      return x < -settle;
    });
    if (!walked) return;
    const from = { x, phase };
    const settled = await tween(
      GAIT.T * 520,
      (t) => {
        st.x = lerp(from.x, 0, t);
        walkPose(from.phase + 0.42 * t, 1 - t);
      },
      easeOut,
    );
    if (!settled) return;
    Object.assign(st, { x: 0, alpha: 1 });
    idle = true;
  }

  /**
   * He changes pose on a squash and stretch: he sinks into his knees, the
   * drawing changes at the bottom, where the motion hides the cut, and he
   * springs up. Done, he wobbles like a bobblehead; friendly, he waves.
   */
  async function swap(art: CusoArt) {
    token += 1;
    const mine = token;
    idle = false;
    const from = shown;
    Object.assign(st, { x: 0, y: 0, rot: 0, scale: 1, alpha: 1 });
    const sank = await tween(
      110,
      (t) => {
        st.squash = 0.07 * t;
        if (from === "walking") walkPose(0, 0, 22 * t);
      },
      easeOut,
    );
    if (!sank) return;
    turn(rig.wave, WAVE_PIVOT, art === "friendly" ? 30 : 0); // before the next paint
    show(art);
    const sprang = await tween(420, (_, r) => {
      st.squash = 0.07 * ring(r * 0.42, 3, 5);
      if (art === "friendly") {
        turn(rig.wave, WAVE_PIVOT, 30 * (1 - easeOut(r)));
      }
    });
    st.squash = 0;
    if (!sprang) return;
    if (art === "correct") {
      const wobbled = await tween(900, (_, r) => {
        const s = r * 0.9;
        st.rot = 13 * Math.exp(-4.2 * s) * Math.sin(2 * Math.PI * 3 * s);
        st.y =
          -0.055 * Math.exp(-7 * s) * Math.sin(Math.PI * Math.min(1, s * 4));
        st.scale =
          1 +
          0.1 *
            Math.exp(-6 * s) *
            Math.cos(2 * Math.PI * 2.4 * s) *
            (s < 0.03 ? s / 0.03 : 1);
      });
      if (!wobbled) return;
      Object.assign(st, { y: 0, rot: 0, scale: 1 });
    }
    idle = true;
    if (art === "friendly" && mine === token) {
      lastWave = performance.now();
      await wave(2.5);
    }
  }

  /**
   * A hop with weight: he crouches, stretches as he takes off, rises on a
   * ballistic arc (fast up, hanging at the top, fast down) leaning a little,
   * squashes on landing and settles on a damped spring. A wave carries on
   * through it; a new pose cancels it.
   */
  async function hop() {
    if (!idle || stopped) return;
    idle = false;
    const lean = shown === "pointing" ? 3 : -3; // toward his hand
    const crouched = await tween(
      140,
      (t) => {
        st.squash = 0.09 * t;
      },
      easeOut,
    );
    if (!crouched) return;
    const flew = await tween(420, (_, r) => {
      const air = 4 * r * (1 - r); // 0 on the ground, 1 at the top
      st.y = -0.075 * air;
      st.rot = lean * Math.sin(Math.PI * r);
      // Stretched leaving and nearing the ground, round at the top; the
      // crouch springs into the stretch over the first frames.
      const stretch = -0.06 * (1 - air);
      st.squash = r < 0.12 ? lerp(0.09, stretch, smooth(r / 0.12)) : stretch;
    });
    if (!flew) return;
    const landed = await tween(380, (_, r) => {
      st.y = 0;
      st.rot = 0;
      st.squash = 0.1 * ring(r * 0.38, 3.2, 9);
    });
    if (!landed) return;
    st.squash = 0;
    idle = true;
  }

  // At rest he breathes; friendly, he waves every seven seconds; looking
  // something up, he sways with his glass. Breath and sway ease in and out
  // as he comes to rest or starts to move, so neither pops.
  let calm = 0;
  let glass = 0;
  let last = performance.now();
  function idleLoop(now: number) {
    if (stopped) return;
    const ease = Math.min(1, ((now - last) / 1000) * 5);
    last = now;
    calm += ((idle ? 1 : 0) - calm) * ease;
    glass += ((idle && shown === "researching" ? 1 : 0) - glass) * ease;
    breathe = 1 + 0.012 * calm * Math.sin((now / 1000) * 2.2);
    sway = 1.6 * glass * Math.sin((now / 1000) * 1.4);
    // A hidden sidebar (a short window) gives him no size: nothing to draw.
    if (idle && !document.hidden && size() > 0) {
      render();
      if (shown === "friendly" && now - lastWave > WAVE_EVERY_MS) {
        lastWave = now;
        void wave(2);
      }
    } else lastWave = now;
    raf = requestAnimationFrame(idleLoop);
  }
  raf = requestAnimationFrame(idleLoop);

  return {
    pose(art) {
      if (stopped || art === target) return;
      target = art;
      if (shown === null) {
        // His first pose shows as it is: the page just opened.
        show(art);
        if (art === "walking") walkPose(0, 0);
        render();
        idle = true;
        lastWave = performance.now() - WAVE_EVERY_MS + 1200;
      } else if (art === "walking") void walkIn();
      else void swap(art);
    },
    hop() {
      void hop();
    },
    stop() {
      stopped = true;
      token += 1;
      cancelAnimationFrame(raf);
    },
  };
}
