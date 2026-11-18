import { normalizeHex } from "@sokosumi/utils";

export interface WheelColor {
  /** Angle in degrees, clockwise from red. */
  hue: number;
  /** Distance from the centre of the wheel, in percent. */
  saturation: number;
  /** HSV value, in percent. */
  brightness: number;
}

const TURN_DEGREES = 360;
const SECTOR_DEGREES = TURN_DEGREES / 6;
const RADIANS_PER_DEGREE = Math.PI / 180;
const MAX_CHANNEL = 255;

export function normalizeTagHex(
  value: string | null | undefined,
): string | null {
  // The brand parser also accepts shorthand. While typing, three digits are
  // still an incomplete six-digit tag color.
  if (!value || value.trim().length < 6) return null;
  return normalizeHex(value)?.toUpperCase() ?? null;
}

function wrapHue(degrees: number): number {
  return ((degrees % TURN_DEGREES) + TURN_DEGREES) % TURN_DEGREES;
}

export function hexToWheelColor(hex: string): WheelColor {
  const normalized = normalizeTagHex(hex);
  if (!normalized) throw new RangeError("Expected a six-digit hex color");

  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  const brightest = Math.max(red, green, blue);
  const chroma = brightest - Math.min(red, green, blue);
  const brightness = (brightest / MAX_CHANNEL) * 100;

  if (chroma === 0) return { hue: 0, saturation: 0, brightness };

  let sector: number;
  if (brightest === red) sector = (green - blue) / chroma;
  else if (brightest === green) sector = (blue - red) / chroma + 2;
  else sector = (red - green) / chroma + 4;

  return {
    hue: wrapHue(sector * SECTOR_DEGREES),
    saturation: (chroma / brightest) * 100,
    brightness,
  };
}

function unitFromPercent(percent: number): number {
  return Math.max(0, Math.min(100, percent)) / 100;
}

export function wheelColorToHex({
  hue,
  saturation,
  brightness,
}: WheelColor): string {
  const sector = wrapHue(hue) / SECTOR_DEGREES;
  const value = unitFromPercent(brightness);
  const chroma = value * unitFromPercent(saturation);
  const secondary = chroma * (1 - Math.abs((sector % 2) - 1));
  const minimum = value - chroma;
  const channels = [
    [chroma, secondary, 0],
    [secondary, chroma, 0],
    [0, chroma, secondary],
    [0, secondary, chroma],
    [secondary, 0, chroma],
    [chroma, 0, secondary],
  ][Math.floor(sector)];
  return (
    "#" +
    channels
      .map((channel) =>
        Math.round((channel + minimum) * MAX_CHANNEL)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
      .toUpperCase()
  );
}

/** Pointer coordinates relative to the centre, measured in wheel radii. */
export function wheelColorAtPoint(
  x: number,
  y: number,
): Pick<WheelColor, "hue" | "saturation"> {
  return {
    hue: wrapHue(Math.atan2(y, x) / RADIANS_PER_DEGREE),
    saturation: Math.min(1, Math.hypot(x, y)) * 100,
  };
}

export function wheelColorPoint({ hue, saturation }: WheelColor): {
  x: number;
  y: number;
} {
  const angle = hue * RADIANS_PER_DEGREE;
  const radius = unitFromPercent(saturation);
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}
