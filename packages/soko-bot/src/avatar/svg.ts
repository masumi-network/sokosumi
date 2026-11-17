import { AVATAR_BASES } from "./bases.js";
import {
  AVATAR_PALETTE,
  AVATAR_SIZES,
  type AvatarColour,
  type AvatarLook,
  rgbDistance,
} from "./code.js";

const hexOf = (c: AvatarColour | string) =>
  c in AVATAR_PALETTE ? AVATAR_PALETTE[c as AvatarColour].hex : c;
/** The first colour that reads against everything in `against`, else white or ink. */
function pick(prefs: string[], against: string[], min = 110): string {
  for (const p of prefs) {
    const c = hexOf(p);
    if (against.every((x) => rgbDistance(c, x) >= min)) return c;
  }
  const first = against[0] ?? "#ffffff";
  return rgbDistance("#ffffff", first) > rgbDistance("#0c0c0c", first)
    ? "#ffffff"
    : "#0c0c0c";
}

const n = (v: number) => String(Math.round(v * 100) / 100);
const deg = (r: number) => n((r * 180) / Math.PI);
const attrs = (a: Record<string, string | number>) =>
  Object.entries(a)
    .map(([k, v]) => ` ${k}="${typeof v === "number" ? n(v) : v}"`)
    .join("");
const el = (tag: string, a: Record<string, string | number>) =>
  `<${tag}${attrs(a)}/>`;
const FILL = /fill="(#[0-9a-f]{6})"/;
const fillOf = (s: string) => FILL.exec(s)?.[1] ?? "#000000";

const HAT_COLOURS = {
  party: ["electric", "persimmon", "golden", "sakura", "iris"],
  crown: ["golden", "persimmon", "white", "sand"],
  beanie: ["iris", "electric", "crimson", "persimmon", "ink"],
  cap: ["crimson", "persimmon", "electric", "ink", "white"],
  star: ["golden", "white", "persimmon"],
};

/** Hats in a unit box: origin on the head top, y up is negative, 1 = 0.62 face units. */
function hat(
  kind: keyof typeof HAT_COLOURS,
  main: string,
  second: string,
): string {
  const f = (tag: string, a: Record<string, string | number>, fill = main) =>
    el(tag, { ...a, fill });
  switch (kind) {
    case "party":
      return (
        f("path", { d: "M -0.42 0.12 L 0 -1.25 L 0.42 0.12 Z" }) +
        [
          [-0.12, -0.25, 0.08],
          [0.14, -0.55, 0.07],
          [-0.03, -0.85, 0.06],
        ]
          .map(([cx, cy, r]) =>
            f("circle", { cx: cx!, cy: cy!, r: r! }, second),
          )
          .join("") +
        f("circle", { cx: 0, cy: -1.27, r: 0.15 }, second)
      );
    case "crown":
      return (
        f("path", {
          d: "M -0.55 0.12 L -0.55 -0.55 L -0.27 -0.28 L 0 -0.72 L 0.27 -0.28 L 0.55 -0.55 L 0.55 0.12 Z",
          "stroke-linejoin": "round",
          stroke: main,
          "stroke-width": 0.08,
        }) +
        [-0.27, 0, 0.27]
          .map((cx) => f("circle", { cx, cy: -0.08, r: 0.07 }, second))
          .join("")
      );
    case "beanie":
      return (
        f("path", {
          d: "M -0.6 0.12 L -0.6 0 A 0.6 0.62 0 0 1 0.6 0 L 0.6 0.12 Z",
        }) +
        f(
          "rect",
          { x: -0.66, y: -0.08, width: 1.32, height: 0.24, rx: 0.12 },
          second,
        ) +
        f("circle", { cx: 0, cy: -0.66, r: 0.16 }, second)
      );
    case "cap":
      return (
        f("path", {
          d: "M -0.72 0.14 L -0.72 0 A 0.72 0.72 0 0 1 0.72 0 L 0.72 0.14 Z",
        }) +
        f("ellipse", { cx: 0.92, cy: 0.06, rx: 0.52, ry: 0.13 }) +
        f("circle", { cx: 0, cy: -0.72, r: 0.09 }, second)
      );
    case "star": {
      const pts = Array.from({ length: 10 }, (_, k) => {
        const r = k % 2 ? 0.17 : 0.4;
        const t = (k / 10) * 2 * Math.PI - Math.PI / 2;
        return `${n(r * Math.cos(t))},${n(-0.36 + r * Math.sin(t))}`;
      });
      return f("polygon", {
        points: pts.join(" "),
        "stroke-linejoin": "round",
        stroke: main,
        "stroke-width": 0.08,
      });
    }
  }
}

/**
 * The avatar a look stands for, as one SVG. Its `#bg`, `#body`, `#eye-l` and `#eye-r` (with
 * `data-cx/cy/r`) are what the live renderer reads; any SVG renderer can draw it as a still.
 */
export function buildAvatarSvg(look: AvatarLook): string {
  const base = AVATAR_BASES[look.animal];
  const bg = AVATAR_PALETTE[look.bg].hex;
  const body = AVATAR_PALETTE[look.body].hex;
  const mark = AVATAR_PALETTE[look.mark].hex;
  // One pass, so a body that takes the old second colour is not swapped twice.
  const swap = new Map([
    [base.body, body],
    [base.mark, mark],
  ]);
  const recolour = (s: string) =>
    s.replace(
      /fill="(#[0-9a-f]{6})"/g,
      (_, h: string) => `fill="${swap.get(h) ?? h}"`,
    );
  const shapes = base.shapes.map(recolour);
  const { g, th } = base;
  const extra: string[] = [];

  // Eyes: each group keeps its centre and reach, so blinking and looking around still work.
  const eyes = base.eyes.map((e) => {
    const parts = e.parts.map(recolour);
    if (look.eyes === "original") return { e, parts };
    const fill = fillOf(parts[e.main] ?? "");
    if (look.eyes === "sparkle") {
      const hl = pick(["white"], [fill], 90);
      const m = Math.min(e.a, e.b);
      parts.push(
        el("circle", {
          cx: e.x + 0.32 * e.a,
          cy: e.y - 0.36 * e.b,
          r: 0.3 * m,
          fill: hl,
        }),
        el("circle", {
          cx: e.x - 0.3 * e.a,
          cy: e.y + 0.34 * e.b,
          r: 0.14 * m,
          fill: hl,
        }),
      );
      return { e, parts };
    }
    // The others replace the eye, so they take a colour that reads on what it sits on (the robot's visor).
    const under = e.on >= 0 ? fillOf(shapes[e.on] ?? "") : body;
    const ink = pick([fill, "crimson", "ink", "white"], [under], 100);
    if (look.eyes === "dots")
      return {
        e,
        parts: [el("circle", { cx: e.x, cy: e.y, r: 0.6 * e.s, fill: ink })],
      };
    const up = look.eyes === "happy" ? -1 : 1;
    const w = 0.95 * e.s;
    const d = `M ${n(-w)} ${n(-up * 0.25 * w)} Q 0 ${n(up * 1.05 * w)} ${n(w)} ${n(-up * 0.25 * w)}`;
    return {
      e,
      parts: [
        el("path", {
          d,
          transform: `translate(${n(e.x)} ${n(e.y)}) rotate(${deg(th)})`,
          fill: "none",
          stroke: ink,
          "stroke-width": 0.36 * e.s,
          "stroke-linecap": "round",
        }),
      ],
    };
  });

  // Cheeks: ovals under and outside the eyes (on all 16 bases they stay inside the outline).
  if (look.cheeks === "blush" && !base.blush) {
    const blush = pick(
      ["sakura", "electric", "persimmon", "scarlet"],
      [body],
      90,
    );
    const cheeks = base.eyes.map((e, i) => {
      const out = i ? 1 : -1;
      const x = e.x + out * 0.14 * g * Math.cos(th) - Math.sin(th) * 0.3 * g;
      const y = e.y + out * 0.14 * g * Math.sin(th) + Math.cos(th) * 0.3 * g;
      return el("ellipse", {
        cx: x,
        cy: y,
        rx: 0.13 * g,
        ry: 0.075 * g,
        transform: `rotate(${deg(th)} ${n(x)} ${n(y)})`,
        fill: blush,
      });
    });
    extra.push(...cheeks);
  }

  // Mouth: the drawn one comes out, the chosen one goes where it was.
  if (look.mouth !== "original" && base.mouth) {
    const fill = fillOf(shapes[base.mouth.i] ?? "");
    shapes[base.mouth.i] = "";
    const m = 0.13 * g;
    const inner =
      look.mouth === "smile"
        ? el("path", {
            d: "M -1 -0.2 Q 0 0.9 1 -0.2",
            fill: "none",
            stroke: fill,
            "stroke-width": 0.32,
            "stroke-linecap": "round",
          })
        : look.mouth === "open"
          ? el("ellipse", { cx: 0, cy: 0.15, rx: 0.5, ry: 0.62, fill })
          : el("path", {
              d: "M -0.95 -0.3 Q 0 -0.45 0.95 -0.3 Q 0.9 1 0 1 Q -0.9 1 -0.95 -0.3 Z",
              fill,
            }) +
            el("ellipse", {
              cx: 0,
              cy: 0.72,
              rx: 0.48,
              ry: 0.3,
              fill: pick(["sakura", "electric", "scarlet"], [fill], 90),
            });
    extra.push(
      `<g transform="translate(${n(base.mouth.x)} ${n(base.mouth.y)}) rotate(${deg(th)}) scale(${n(m)})">${inner}</g>`,
    );
  }

  // Headwear: on the top of the head, tilted with it, in colours that read on the animal and the background.
  if (look.hat !== "none") {
    const main = pick(HAT_COLOURS[look.hat], [body, bg]);
    const second = pick(
      look.hat === "beanie"
        ? ["golden", "white", "crimson"]
        : ["white", "golden", "crimson", "ink"],
      [main],
    );
    extra.push(
      `<g transform="translate(${n(base.top.x)} ${n(base.top.y)}) rotate(${deg(base.top.th)}) scale(${n(0.62 * g)})">${hat(look.hat, main, second)}</g>`,
    );
  }

  // Mirror to the chosen corner and scale from the frame's bottom edge; the eye data follows.
  const flip = look.corner === base.corner ? 1 : -1;
  const k = AVATAR_SIZES[look.size];
  const ox = base.pad + base.S / 2;
  const oy = base.pad + base.S;
  const eyeGroups = eyes.map(
    ({ e, parts }, i) =>
      `<g id="eye-${i ? "r" : "l"}"${attrs({
        "data-cx": ox + flip * k * (e.cx - ox),
        "data-cy": oy + k * (e.cy - oy),
        "data-r": k * e.r,
      })}>${parts.join("")}</g>`,
  );
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${base.pad} ${base.pad} ${base.S} ${base.S}">` +
    el("rect", {
      id: "bg",
      x: 0,
      y: 0,
      width: base.W,
      height: base.W,
      fill: bg,
    }) +
    `<g transform="translate(${n(ox)} ${n(oy)}) scale(${n(flip * k)} ${n(k)}) translate(${n(-ox)} ${n(-oy)})">` +
    `<g id="body">${shapes.join("")}${extra.join("")}</g>${eyeGroups.join("")}</g></svg>`
  );
}
