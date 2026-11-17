import {
  AVATAR_BASES,
  type AvatarLook,
  buildAvatarSvg,
  parseAvatarCode,
} from "@sokosumi/soko-bot";
import { type AvatarModel, avatarModel } from "./model";

/** Never rasterise past this many pixels a side: the shader's cost grows with the area. */
const MAX_PX = 1024;
const CACHE_LIMIT = 24;

/** Canvas pixels for a CSS size: twice the device pixels, smoothed down by the browser. */
export function canvasPx(size: number, dpr: number): number {
  return Math.max(16, Math.min(MAX_PX, Math.ceil(size * dpr * 2)));
}

/** A stable number per avatar, so each bot blinks on its own schedule. */
export function seedOf(code: string): number {
  let h = 2166136261;
  for (let i = 0; i < code.length; i++)
    h = Math.imul(h ^ code.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The avatar as a still picture (a data URL), for before the live one is ready. */
export function stillSrc(look: AvatarLook): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildAvatarSvg(look))}`;
}

const models = new Map<string, Promise<AvatarModel>>();

/** The same bot appears many times at one size; build its model once. */
export function loadAvatarModel(
  look: AvatarLook,
  code: string,
  px: number,
): Promise<AvatarModel> {
  const key = `${code}@${px}`;
  const hit = models.get(key);
  if (hit) return hit;
  const made = avatarModel(buildAvatarSvg(look), AVATAR_BASES[look.animal], px);
  made.catch(() => models.delete(key));
  models.set(key, made);
  if (models.size > CACHE_LIMIT) {
    const oldest = models.keys().next().value;
    if (oldest !== undefined) models.delete(oldest);
  }
  return made;
}

export { parseAvatarCode };
