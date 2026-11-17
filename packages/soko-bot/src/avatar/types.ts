export const AVATAR_ANIMALS = [
  "axolotl",
  "bear",
  "cat",
  "duckling",
  "elephant",
  "fox",
  "frog",
  "hedgehog",
  "koala",
  "otter",
  "owl",
  "penguin",
  "rabbit",
  "robot",
  "sloth",
  "whale",
] as const;
export type AvatarAnimal = (typeof AVATAR_ANIMALS)[number];

/** One eye group of a traced animal, in its SVG's units. */
export interface AvatarEye {
  /** Centre and reach of the group: the live renderer moves and blinks everything within it. */
  cx: number;
  cy: number;
  r: number;
  /** The group's elements, each a full SVG element string with a `fill`. */
  parts: string[];
  /** Index in `parts` of the eye itself (not its white). */
  main: number;
  /** Centre and half-size of that element, and the half-size of the whole eye. */
  x: number;
  y: number;
  a: number;
  b: number;
  s: number;
  /** Index in the body's `shapes` of what the eye sits on, or -1 for the body itself. */
  on: number;
}

/** A traced animal: its frame, recipe colours, drawing and face landmarks. */
export interface AvatarBase {
  /** The frame is `pad pad S S` inside `0 0 W W` (the drawing continues past the frame). */
  S: number;
  pad: number;
  W: number;
  bg: string;
  body: string;
  mark: string;
  /** The lower corner the animal rises from in its drawing. */
  corner: "l" | "r";
  /** The body group's elements; index 0 is the silhouette. */
  shapes: string[];
  eyes: [AvatarEye, AvatarEye];
  /** The face unit (eye gap, capped) and the eye line's angle in radians. */
  g: number;
  th: number;
  /** The drawn mouth (index in `shapes`) and its centre, when it is a separate small mark. */
  mouth: { i: number; x: number; y: number } | null;
  /** The top of the head above the eyes, and the tilt a hat takes there. */
  top: { x: number; y: number; th: number };
  /** The drawing already has blush. */
  blush: boolean;
}
