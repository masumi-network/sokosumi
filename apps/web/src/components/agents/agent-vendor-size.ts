/**
 * Logos are sized to one area, not one height: a wide wordmark comes out
 * lower and a compact one taller, so all read at about the same weight as
 * the text line beside them. Heights stay within the line's bounds.
 */
export const LOGO_SIZE = {
  /** Next to a text-xs meta line, never wider than the room before a button. */
  sm: { area: 420, min: 8, max: 14, maxWidth: 96 },
  /** Next to text-sm / text-base, as in a profile byline. */
  md: { area: 640, min: 10, max: 18, maxWidth: 128 },
} as const;

export function logoHeight(ratio: number, size: LogoSize): number {
  const { area, min, max, maxWidth } = LOGO_SIZE[size];
  const byArea = Math.sqrt(area / ratio);
  const fits = Math.floor(maxWidth / ratio);
  return Math.min(max, fits, Math.round(Math.max(min, byArea)));
}

export type LogoSize = keyof typeof LOGO_SIZE;
