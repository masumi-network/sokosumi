import { edt } from "./rig";

export interface AvatarFrame {
  S: number;
  pad: number;
  W: number;
}

/** What the GPU draws from: textures and landmarks, all in texture uv. */
export interface AvatarModel {
  size: number;
  face: HTMLCanvasElement;
  eyes: HTMLCanvasElement;
  height: Uint8Array;
  f0: number;
  fs: number;
  rz: number;
  pivot: [number, number];
  bg: [number, number, number];
  eyeList: { c: [number, number]; r: number }[];
}

const loadSvg = (svg: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("avatar svg failed to load"));
    i.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });

async function raster(svgText: string, view: number, size: number) {
  const img = await loadSvg(
    svgText.replace(
      /viewBox="[^"]*"/,
      `viewBox="0 0 ${view} ${view}" width="${size}" height="${size}"`,
    ),
  );
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(img, 0, 0, size, size);
  return c;
}

/** 0..1 channels of a `#rrggbb` fill; white when the SVG has none. */
const rgbOf = (hex: string | null | undefined): [number, number, number] =>
  hex && /^#[0-9a-f]{6}$/i.test(hex)
    ? ([1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [
        number,
        number,
        number,
      ])
    : [1, 1, 1];

/**
 * Rasterise an avatar SVG (padded viewBox `pad pad S S` inside `0 0 W W`) for a frame `px`
 * device pixels wide and derive its height field: an elliptical fillet of the distance to the
 * outline, with narrow gaps closed first so a thin curled part turns with the body.
 */
export async function avatarModel(
  svg: string,
  { S, pad, W }: AvatarFrame,
  px: number,
): Promise<AvatarModel> {
  const size = Math.round((px * W) / S);
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const strip = (ids: string[]) => {
    const d = doc.cloneNode(true) as Document;
    for (const id of ids) d.getElementById(id)?.remove();
    return new XMLSerializer().serializeToString(d);
  };
  const eyeEls = ["eye-l", "eye-r"]
    .map((id) => doc.getElementById(id))
    .filter((el): el is NonNullable<typeof el> => el !== null);
  const face = await raster(strip(["bg", "eye-l", "eye-r"]), W, size);
  const eyes = await raster(strip(["bg", "body"]), W, size);
  const fctx = face.getContext("2d", { willReadFrequently: true });
  if (!fctx) throw new Error("no 2d context");
  const img = fctx.getImageData(0, 0, size, size);
  const px4 = img.data;
  const n = size * size;
  const covered = new Uint8Array(n);
  for (let p = 0; p < n; p++)
    covered[p] = (px4[p * 4 + 3] as number) > 5 ? 1 : 0;
  // Edge pixels carry the colour of the nearest solid one: a side wall seen at an angle
  // is made of them, and their own colour is half background.
  const solid = new Float64Array(n);
  const near = new Int32Array(n);
  for (let p = 0; p < n; p++)
    solid[p] = (px4[p * 4 + 3] as number) > 250 ? 0 : 1e20;
  edt(solid, size, near);
  for (let p = 0; p < n; p++) {
    const s = solid[p] as number;
    if (s > 0 && s < 1e9) {
      const q = (near[p] as number) * 4;
      px4[p * 4] = px4[q] as number;
      px4[p * 4 + 1] = px4[q + 1] as number;
      px4[p * 4 + 2] = px4[q + 2] as number;
    }
  }
  // Opaque everywhere: a canvas drops the colour of transparent pixels, and the shape is in `height`.
  for (let p = 0; p < n; p++) px4[p * 4 + 3] = 255;
  fctx.putImageData(img, 0, 0);

  const d = new Float64Array(n);
  const close = Math.round((S / W) * size * 0.05);
  const grow = new Float64Array(n);
  for (let p = 0; p < n; p++) grow[p] = covered[p] ? 0 : 1e20;
  edt(grow, size);
  for (let p = 0; p < n; p++) d[p] = (grow[p] as number) <= close ? 1e20 : 0;
  edt(d, size);
  for (let p = 0; p < n; p++) {
    const v = d[p] as number;
    d[p] = covered[p] || v > close ? Math.max(0, v - close) : 0;
  }
  const f0 = pad / W;
  const fs = S / W;
  const lo = Math.round(f0 * size);
  const hi = Math.round((f0 + fs) * size);
  let maxD = 0;
  let sx = 0;
  let sy = 0;
  let count = 0;
  for (let y = lo; y < hi; y++)
    for (let x = lo; x < hi; x++) {
      const v = d[y * size + x] as number;
      if (v > maxD) maxD = v;
      if (covered[y * size + x]) {
        sx += x;
        sy += y;
        count++;
      }
    }
  const rxy = Math.min(maxD, fs * size * 0.12);
  const rz = rxy * 0.85;
  const height = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (!covered[p]) continue;
    const u = 1 - Math.min((d[p] as number) / rxy, 1);
    // At least one level, so the antialiased rim is part of the body and blends into the background.
    height[p] = Math.max(1, Math.round(255 * Math.sqrt(1 - u * u)));
  }
  const k = 1 / size;
  const c = Math.max(count, 1);
  return {
    size,
    face,
    eyes,
    height,
    f0,
    fs,
    rz: rz * k,
    pivot: [(sx / c) * k, (sy / c) * k],
    bg: rgbOf(doc.getElementById("bg")?.getAttribute("fill")),
    eyeList: eyeEls.map((el) => ({
      c: [
        Number(el.getAttribute("data-cx")) / W,
        Number(el.getAttribute("data-cy")) / W,
      ] as [number, number],
      r: Number(el.getAttribute("data-r")) / W,
    })),
  };
}
