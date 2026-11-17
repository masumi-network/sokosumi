import { z } from "zod";

import { AVATAR_BASES } from "./bases.js";
import { AVATAR_ANIMALS, type AvatarAnimal } from "./types.js";

/** The Masumi palette, with the colour families the recipe keeps apart. */
export const AVATAR_PALETTE = {
  crimson: { hex: "#460a23", family: "dark" },
  iris: { hex: "#ff51ff", family: "pink" },
  electric: { hex: "#fa008c", family: "pink" },
  sakura: { hex: "#ff6ed2", family: "pink" },
  peach: { hex: "#ffc8f0", family: "pink" },
  sand: { hex: "#d7be8c", family: "sand" },
  persimmon: { hex: "#ff6400", family: "warm" },
  scarlet: { hex: "#fa140a", family: "warm" },
  golden: { hex: "#ffd300", family: "yellow" },
  white: { hex: "#ffffff", family: "light" },
  ink: { hex: "#0c0c0c", family: "dark" },
} as const;
export type AvatarColour = keyof typeof AVATAR_PALETTE;
export const AVATAR_COLOURS = Object.keys(AVATAR_PALETTE) as AvatarColour[];

/** Every palette colour except the neutrals is a background (the recipe's BACKGROUNDS). */
export const AVATAR_BACKGROUNDS = [
  "iris",
  "golden",
  "crimson",
  "peach",
  "persimmon",
  "sakura",
  "sand",
  "electric",
  "scarlet",
] as const satisfies readonly AvatarColour[];
export type AvatarBackground = (typeof AVATAR_BACKGROUNDS)[number];

export const AVATAR_CORNERS = ["l", "r"] as const;
export const AVATAR_SIZES = { S: 0.9, M: 1, L: 1.1 } as const;
export type AvatarSize = keyof typeof AVATAR_SIZES;
export const AVATAR_EYES = [
  "original",
  "sparkle",
  "happy",
  "sleepy",
  "dots",
] as const;
export const AVATAR_MOUTHS = ["original", "smile", "open", "tongue"] as const;
export const AVATAR_CHEEKS = ["none", "blush"] as const;
export const AVATAR_HATS = [
  "none",
  "party",
  "crown",
  "beanie",
  "cap",
  "star",
] as const;

export interface AvatarLook {
  animal: AvatarAnimal;
  bg: AvatarBackground;
  body: AvatarColour;
  mark: AvatarColour;
  corner: (typeof AVATAR_CORNERS)[number];
  size: AvatarSize;
  eyes: (typeof AVATAR_EYES)[number];
  mouth: (typeof AVATAR_MOUTHS)[number];
  cheeks: (typeof AVATAR_CHEEKS)[number];
  hat: (typeof AVATAR_HATS)[number];
}

const rgb = (hex: string) =>
  [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
/** Straight RGB distance: what "reads against" means throughout the avatar. */
export function rgbDistance(a: string, b: string): number {
  const x = rgb(a);
  const y = rgb(b);
  return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);
}

/** The animal never sits on its own colour family, and its second colour reads on it. */
export function isReadable(
  bg: AvatarColour,
  body: AvatarColour,
  mark: AvatarColour,
): boolean {
  return (
    AVATAR_PALETTE[body].family !== AVATAR_PALETTE[bg].family &&
    rgbDistance(AVATAR_PALETTE[mark].hex, AVATAR_PALETTE[body].hex) >= 100 &&
    mark !== bg
  );
}

/** A new mouth needs a separate drawn mouth; blush only where the drawing has none. */
export function featureOptions(animal: AvatarAnimal) {
  const base = AVATAR_BASES[animal];
  return {
    mouth: base.mouth ? AVATAR_MOUTHS : (["original"] as const),
    cheeks: base.blush ? (["none"] as const) : AVATAR_CHEEKS,
  };
}

const COLOUR_SETS: [AvatarBackground, AvatarColour, AvatarColour][] =
  AVATAR_BACKGROUNDS.flatMap((bg) =>
    AVATAR_COLOURS.flatMap((body) =>
      AVATAR_COLOURS.filter((mark) => isReadable(bg, body, mark)).map(
        (mark) =>
          [bg, body, mark] as [AvatarBackground, AvatarColour, AvatarColour],
      ),
    ),
  );

/** How many distinct avatars the rules allow. */
export const AVATAR_COMBINATIONS = AVATAR_ANIMALS.reduce((sum, animal) => {
  const o = featureOptions(animal);
  return (
    sum +
    COLOUR_SETS.length *
      AVATAR_CORNERS.length *
      Object.keys(AVATAR_SIZES).length *
      AVATAR_EYES.length *
      o.mouth.length *
      o.cheeks.length *
      AVATAR_HATS.length
  );
}, 0);

const VERSION = "v1";
const PARTS = [
  "animal",
  "bg",
  "body",
  "mark",
  "corner",
  "size",
  "eyes",
  "mouth",
  "cheeks",
  "hat",
] as const satisfies readonly (keyof AvatarLook)[];

export function formatAvatarCode(look: AvatarLook): string {
  return [VERSION, ...PARTS.map((p) => look[p])].join(".");
}

const oneOf = <T extends string>(
  list: readonly T[],
  v: string | undefined,
): v is T => v !== undefined && (list as readonly string[]).includes(v);

/** The look a code stands for, or null when it is malformed or breaks a rule. */
export function parseAvatarCode(code: string): AvatarLook | null {
  const [
    version,
    animal,
    bg,
    body,
    mark,
    corner,
    size,
    eyes,
    mouth,
    cheeks,
    hat,
    ...rest
  ] = code.split(".");
  if (version !== VERSION || rest.length > 0) return null;
  if (
    !oneOf(AVATAR_ANIMALS, animal) ||
    !oneOf(AVATAR_BACKGROUNDS, bg) ||
    !oneOf(AVATAR_COLOURS, body) ||
    !oneOf(AVATAR_COLOURS, mark) ||
    !oneOf(AVATAR_CORNERS, corner) ||
    !oneOf(Object.keys(AVATAR_SIZES) as AvatarSize[], size) ||
    !oneOf(AVATAR_EYES, eyes) ||
    !oneOf(AVATAR_MOUTHS, mouth) ||
    !oneOf(AVATAR_CHEEKS, cheeks) ||
    !oneOf(AVATAR_HATS, hat)
  )
    return null;
  const o = featureOptions(animal);
  if (
    !isReadable(bg, body, mark) ||
    !oneOf(o.mouth, mouth) ||
    !oneOf(o.cheeks, cheeks)
  )
    return null;
  return { animal, bg, body, mark, corner, size, eyes, mouth, cheeks, hat };
}

export const avatarCodeSchema = z
  .string()
  .max(120)
  .refine((code) => parseAvatarCode(code) !== null, {
    message: "Invalid avatar code",
  });

const nameOf = (hex: string) =>
  AVATAR_COLOURS.find((c) => AVATAR_PALETTE[c].hex === hex);

/** The animal as drawn: its own colours and corner, no new features. */
export function originalAvatarLook(
  animal: AvatarAnimal,
  bg?: AvatarBackground,
): AvatarLook {
  const base = AVATAR_BASES[animal];
  const body = nameOf(base.body);
  const mark = nameOf(base.mark);
  const ownBg = nameOf(base.bg) as AvatarBackground | undefined;
  if (!body || !mark || !ownBg)
    throw new Error(`Avatar base ${animal} is off the palette`);
  const look: AvatarLook = {
    animal,
    bg: bg && isReadable(bg, body, mark) ? bg : ownBg,
    body,
    mark,
    corner: base.corner,
    size: "M",
    eyes: "original",
    mouth: "original",
    cheeks: "none",
    hat: "none",
  };
  return look;
}

const any = <T>(list: readonly T[], rand: () => number): T =>
  list[Math.floor(rand() * list.length)]!;

/** A random look within the rules. Uniqueness is the database's job. */
export function randomAvatarLook(rand: () => number = Math.random): AvatarLook {
  const animal = any(AVATAR_ANIMALS, rand);
  const [bg, body, mark] = any(COLOUR_SETS, rand);
  const o = featureOptions(animal);
  return {
    animal,
    bg,
    body,
    mark,
    corner: any(AVATAR_CORNERS, rand),
    size: any(Object.keys(AVATAR_SIZES) as AvatarSize[], rand),
    eyes: any(AVATAR_EYES, rand),
    mouth: any(o.mouth, rand),
    cheeks: any(o.cheeks, rand),
    hat: any(AVATAR_HATS, rand),
  };
}

/**
 * Looks for a bot that had a pool picture of `animal` on `bg`, closest first: the drawing
 * as is, then the other corner, other sizes, other eyes, then a hat. The first one no other
 * bot holds is its look.
 */
export function closestAvatarLooks(
  animal: AvatarAnimal,
  bg: AvatarBackground,
): AvatarLook[] {
  const own = originalAvatarLook(animal, bg);
  const other: AvatarLook["corner"] = own.corner === "l" ? "r" : "l";
  const looks: AvatarLook[] = [];
  for (const hat of AVATAR_HATS)
    for (const eyes of AVATAR_EYES)
      for (const size of ["M", "S", "L"] as const)
        for (const corner of [own.corner, other])
          looks.push({ ...own, hat, eyes, size, corner });
  return looks;
}
