const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function revealOnScroll() {
  const items = document.querySelectorAll(".reveal");
  if (reducedMotion || !("IntersectionObserver" in window)) return;
  document.documentElement.classList.add("anim");
  const seen = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("in");
        seen.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -12% 0px" },
  );
  items.forEach((item) => seen.observe(item));
}

// ---- Cuso in the hero ----
// He walks in from the back of the page, turns to wave, waves now and then, and reacts when pressed.
// His poses come from assets/cuso/poses.svg (made by scripts/cuso-poses.py). Lengths below are in
// the walking pose's SVG units; the pose box is that many units wide.
const GROUND = 1344; // where the feet stand
const ANKLE_UP = 138; // the ankle's height above the ground on a flat shoe
const SHOE = { ankle: [875, 1200], flat: 23 }; // the drawn shoe is mid heel-strike, toe up 23 degrees
const HIPS = { near: [850, 1060], far: [588, 930] }; // where the drawing attaches each leg
const REST = { near: GROUND - ANKLE_UP - HIPS.near[1], far: GROUND - ANKLE_UP - HIPS.far[1] }; // hip to ankle, standing
const REACH = { near: REST.near * 1.22, far: REST.far * 1.1 }; // full leg length
const ARMS = { armL: [365, 700], armR: [880, 815] };
const WAVE_PIVOT = [1265, 1190]; // the friendly pose's shoulder
const GAIT = { T: 0.44, stance: 0.6, S: 190, LIFT: 56, ARM: 24, LEAN: 4, BOB: 24 }; // short legs: short, quick steps
const REACTIONS = ["idea", "done", "correct"];

const smooth = (t) => t * t * (3 - 2 * t);
const wrap = (p) => ((p % 1) + 1) % 1;
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - (1 - t) ** 3;
// A damped spring: starts at 1, rings f times a second and dies out at rate k.
const ring = (t, f, k) => Math.exp(-k * t) * Math.cos(2 * Math.PI * f * t);

// A foot at phase p of its cycle: offset from its hip, height, shoe angle (+ is toe down).
// It stays planted while the hip passes over it and rolls heel to toe, then swings forward.
function foot(p, k) {
  if (p < GAIT.stance) {
    const s = p / GAIT.stance;
    const roll = s < 0.25 ? -14 * (1 - smooth(s / 0.25)) : s > 0.75 ? 26 * smooth((s - 0.75) / 0.25) : 0;
    const heel = s > 0.75 ? 34 * ((s - 0.75) / 0.25) ** 1.5 : 0;
    return { dx: (0.5 - s) * GAIT.S * k, up: heel * k, angle: roll * k };
  }
  const s = (p - GAIT.stance) / (1 - GAIT.stance);
  return { dx: (smooth(s) - 0.5) * GAIT.S * k, up: (34 * (1 - s) + GAIT.LIFT * Math.sin(Math.PI * s)) * k, angle: (26 - 40 * smooth(s)) * k };
}

async function bringCusoToLife() {
  const cuso = document.querySelector("[data-cuso]");
  if (!cuso || !document.documentElement.classList.contains("cuso-anim")) return;
  try {
    const res = await fetch("/assets/cuso/poses.svg");
    if (!res.ok) throw new Error(`poses.svg: ${res.status}`);
    const svg = await res.text();
    // The page's fallback already showed the still: he arrived too late, so he stays still.
    if (!document.documentElement.classList.contains("cuso-anim")) return;
    cuso.insertAdjacentHTML("beforeend", svg);
  } catch (error) {
    document.documentElement.classList.remove("cuso-anim"); // show the still instead
    console.error(error);
    return;
  }
  const fig = cuso.lastElementChild;
  fig.classList.add("cuso__fig");
  fig.setAttribute("aria-hidden", "true");
  const shadow = cuso.querySelector(".cuso__shadow");
  const poses = {};
  fig.querySelectorAll("[data-pose]").forEach((el) => (poses[el.dataset.pose] = el));
  const part = (n) => fig.querySelector(`[data-part="${n}"]`);
  const legEl = (n) => {
    const g = fig.querySelector(`[data-leg="${n}"]`);
    return { tubes: g.querySelectorAll("[data-tube]"), shoe: g.querySelector("[data-shoe]") };
  };
  const rig = { armL: part("armL"), armR: part("armR"), body: part("body"), wave: part("wave"), near: legEl("near"), far: legEl("far") };
  const arrive = () => cuso.parentElement.classList.add("is-arrived"); // pops the stickers in
  const unit = () => cuso.clientWidth / poses.walk.viewBox.baseVal.width; // px per walking-pose unit

  const st = { x: 0, y: 0, gy: 0, rot: 0, scale: 1, squash: 0, alpha: 1, breathe: 1 }; // gy: where his ground is
  let idle = false;
  let token = 0;
  let next = 0;
  let onScreen = true;
  new IntersectionObserver(([entry]) => (onScreen = entry.isIntersecting)).observe(cuso);

  function render() {
    const s = st.scale * st.breathe;
    fig.style.transform = `translate(${st.x}px, ${st.gy + st.y}px) rotate(${st.rot}deg) scale(${s * (1 + 0.5 * st.squash)}, ${s * (1 - st.squash)})`;
    fig.style.opacity = st.alpha;
    const lift = Math.min(1, Math.max(0, -st.y / 140));
    shadow.style.transform = `translate(${st.x}px, ${st.gy}px) scale(${st.scale * (1 - 0.45 * lift)})`;
    shadow.style.opacity = st.alpha * (1 - 0.5 * lift);
  }
  let pose = "";
  const show = (k) => {
    pose = k;
    Object.entries(poses).forEach(([n, el]) => (el.style.visibility = n === k ? "visible" : "hidden"));
  };
  const turn = (el, pivot, deg, pre = "") => el.setAttribute("transform", `${pre}rotate(${deg.toFixed(2)} ${pivot[0]} ${pivot[1]})`);

  // Runs fn every frame until it returns false; stops early if a newer animation starts.
  function frames(fn) {
    const mine = token;
    return new Promise((resolve) => {
      let last = performance.now();
      const tick = (now) => {
        if (mine !== token) return resolve(false);
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const more = fn(dt);
        render();
        if (more === false) return resolve(true);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
  function tween(ms, fn, ease = (t) => t) {
    let t = 0;
    return frames((dt) => {
      t = Math.min(1, t + (dt * 1000) / ms);
      fn(ease(t), t);
      return t < 1;
    });
  }

  function drawLeg(n, f, drop) {
    const hx = HIPS[n][0];
    const hy = HIPS[n][1] + drop;
    const ax = hx + f.dx;
    const ay = GROUND - ANKLE_UP - f.up;
    const dist = Math.hypot(ax - hx, ay - hy);
    // The knee bends forward when the leg is shorter than its reach.
    const bend = Math.sqrt(Math.max(0, REACH[n] ** 2 - dist * dist)) * 0.5;
    const nx = (ay - hy) / dist;
    const ny = -(ax - hx) / dist;
    const d = `M${hx.toFixed(1)} ${hy.toFixed(1)} Q${((hx + ax) / 2 + nx * bend).toFixed(1)} ${((hy + ay) / 2 + ny * bend).toFixed(1)} ${ax.toFixed(1)} ${ay.toFixed(1)}`;
    rig[n].tubes.forEach((t) => t.setAttribute("d", d));
    rig[n].shoe.setAttribute(
      "transform",
      `translate(${(ax - SHOE.ankle[0]).toFixed(1)} ${(ay - SHOE.ankle[1]).toFixed(1)}) rotate(${(SHOE.flat + f.angle).toFixed(2)} ${SHOE.ankle[0]} ${SHOE.ankle[1]})`,
    );
  }
  function walkPose(ph, k, dip = 0) {
    // The hip eases down through each step, lowest just after a foot lands, so steps land softly.
    const drop = GAIT.BOB * k * (0.5 + 0.5 * Math.cos(4 * Math.PI * (ph - 0.1))) + dip;
    drawLeg("far", foot(wrap(ph + 0.5), k), drop);
    drawLeg("near", foot(wrap(ph), k), drop);
    // He leans into the walk and rocks forward a touch at each push-off.
    const rock = GAIT.LEAN * k + 1.6 * k * Math.sin(4 * Math.PI * wrap(ph - 0.12));
    const upper = `translate(0 ${drop.toFixed(1)}) rotate(${rock.toFixed(2)} ${HIPS.near[0]} ${HIPS.near[1]}) `;
    rig.body.setAttribute("transform", upper);
    // Arms swing against the legs and trail them a little.
    const swing = Math.sin(2 * Math.PI * wrap(ph - 0.08)) * GAIT.ARM * k;
    turn(rig.armR, ARMS.armR, swing, upper);
    turn(rig.armL, ARMS.armL, swing * 0.8, upper);
  }

  async function wave(cycles) {
    const mine = token;
    await tween(cycles * 520, (t, r) => turn(rig.wave, WAVE_PIVOT, -12 * Math.sin(Math.PI * r) ** 0.6 * Math.sin(2 * Math.PI * cycles * r)));
    if (mine === token) turn(rig.wave, WAVE_PIVOT, 0);
  }

  async function walkIn() {
    const mine = ++token;
    // Short screens hide the hero art; with no size there is nothing to walk.
    if (!cuso.clientWidth) {
      show("friendly");
      arrive();
      idle = true;
      return;
    }
    idle = false;
    show("walk");
    // He starts small and higher up, far behind the copy, and grows as he nears. Screen x, size
    // and ground height all follow 1/depth, so they change together; his feet cover ground at
    // his current size, so his speed on screen shrinks with him and planted feet never slide.
    const speed = (GAIT.S / (GAIT.stance * GAIT.T)) * unit();
    Object.assign(st, { x: 0, y: 0, gy: 0, rot: 0, scale: 1, squash: 0, alpha: 0 });
    render();
    const settle = speed * GAIT.T * 0.5; // the last half step brings his feet together
    const X0 = -Math.max(settle * 3, Math.min(320, cuso.getBoundingClientRect().left + 40));
    const GY0 = -cuso.clientHeight * 0.2;
    const S0 = 0.42;
    const depth = (x) => {
      const far = x / X0; // 1 at the start, 0 at his spot
      Object.assign(st, { x, scale: 1 - far * (1 - S0), gy: GY0 * far, alpha: Math.min(1, (1 - far) / 0.12) });
    };
    let phase = 0.25;
    let x = X0;
    depth(x);
    const walked = await frames((dt) => {
      x = Math.min(-settle, x + speed * st.scale * dt);
      phase += dt / GAIT.T;
      depth(x);
      walkPose(phase, 1);
      return x < -settle;
    });
    if (!walked) return;
    // Last step: shorter, slower, feet come together under him.
    const from = { x, phase };
    if (!(await tween(GAIT.T * 520, (t) => { depth(lerp(from.x, 0, t)); walkPose(from.phase + 0.42 * t, 1 - t); }, easeOut))) return;
    Object.assign(st, { x: 0, gy: 0, scale: 1, alpha: 1 });
    // He turns to us on a squash and stretch: he sinks into his knees, the drawing changes at the
    // bottom, where the motion hides the cut, and he springs up lifting his hand into the wave.
    if (!(await tween(110, (t) => { st.squash = 0.07 * t; walkPose(0, 0, 22 * t); }, easeOut))) return;
    turn(rig.wave, WAVE_PIVOT, 30); // before the next paint, or the raised hand flashes first
    show("friendly");
    arrive();
    const turned = await tween(420, (t, r) => {
      st.squash = 0.07 * ring(r * 0.42, 3, 5);
      turn(rig.wave, WAVE_PIVOT, 30 * (1 - easeOut(r)));
    });
    st.squash = 0;
    if (!turned) return;
    idle = true;
    if (mine === token) await wave(2.5);
  }

  // Pressed: he pops up, wobbles like a bobblehead in his next pose, then goes back to waving.
  async function react() {
    const mine = ++token;
    idle = false;
    arrive();
    Object.assign(st, { x: 0, gy: 0, squash: 0, alpha: 1 }); // pressed mid walk-in: he is at his spot
    turn(rig.wave, WAVE_PIVOT, 0);
    show(REACTIONS[next++ % REACTIONS.length]);
    if (!(await tween(900, (t, r) => {
      const s = r * 0.9;
      st.rot = 13 * Math.exp(-4.2 * s) * Math.sin(2 * Math.PI * 3 * s);
      st.y = -26 * Math.exp(-7 * s) * Math.sin(Math.PI * Math.min(1, s * 4));
      st.scale = 1 + 0.1 * Math.exp(-6 * s) * Math.cos(2 * Math.PI * 2.4 * s) * (s < 0.03 ? s / 0.03 : 1);
    }))) return;
    Object.assign(st, { y: 0, rot: 0, scale: 1 });
    idle = true;
    await new Promise((r) => setTimeout(r, 1300));
    if (mine !== token) return;
    idle = false;
    if (!(await tween(90, (t) => (st.y = lerp(0, 6, t)), easeOut))) return;
    show("friendly");
    if (!(await tween(150, (t) => (st.y = lerp(6, -8, t)), easeOut))) return;
    if (!(await tween(150, (t) => (st.y = lerp(-8, 0, t)), (t) => t * t))) return;
    idle = true;
  }

  // Idle: he breathes, and waves every seven seconds or so while he is on screen.
  let lastWave = performance.now();
  (function idleLoop(now) {
    st.breathe = idle ? 1 + 0.012 * Math.sin((now / 1000) * 2.2) : 1;
    if (idle && onScreen && !document.hidden) {
      render();
      if (pose === "friendly" && now - lastWave > 7000) {
        lastWave = now;
        wave(2);
      }
    } else lastWave = now;
    requestAnimationFrame(idleLoop);
  })(performance.now());

  cuso.addEventListener("click", react);
  walkIn();
}

// The footer toggle cycles System, Light, Dark. System clears the saved choice.
function themeToggle() {
  const root = document.documentElement;
  const button = document.querySelector("[data-theme-toggle]");
  const system = matchMedia("(prefers-color-scheme: dark)");
  const NEXT = { system: "light", light: "dark", dark: "system" };
  const LABEL = { system: "System", light: "Light", dark: "Dark" };
  let choice = "system";
  try { choice = localStorage.getItem("theme") || "system"; } catch {}
  if (!LABEL[choice]) choice = "system";
  const show = () => {
    const theme = choice === "system" ? (system.matches ? "dark" : "light") : choice;
    root.dataset.theme = theme;
    button.textContent = `Theme: ${LABEL[choice]}`;
    document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#0c0c0c" : "#ffffff";
  };
  button.addEventListener("click", () => {
    choice = NEXT[choice];
    try {
      if (choice === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", choice);
    } catch {}
    show();
  });
  system.addEventListener("change", show);
  show();
}

themeToggle();
revealOnScroll();
bringCusoToLife();
