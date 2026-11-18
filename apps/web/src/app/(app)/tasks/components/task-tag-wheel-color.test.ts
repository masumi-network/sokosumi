import { describe, expect, it } from "vitest";
import {
  hexToWheelColor,
  normalizeTagHex,
  wheelColorAtPoint,
  wheelColorPoint,
  wheelColorToHex,
} from "./task-tag-wheel-color";

describe("tag wheel colors", () => {
  it("accepts complete six-digit input without committing a partial or alpha color", () => {
    expect(normalizeTagHex("  a1b2c3 ")).toBe("#A1B2C3");
    for (const input of [
      null,
      undefined,
      "#ABC",
      "#AABB",
      "#12345678",
      "#12345G",
      "##123456",
    ]) {
      expect(normalizeTagHex(input)).toBeNull();
    }
  });

  it.each([
    [0, "#FF0000"],
    [60, "#FFFF00"],
    [120, "#00FF00"],
    [180, "#00FFFF"],
    [240, "#0000FF"],
    [300, "#FF00FF"],
  ] as const)("maps hue %s to %s in both directions", (hue, hex) => {
    const hsv = { hue, saturation: 100, brightness: 100 };
    expect(hexToWheelColor(hex)).toEqual(hsv);
    expect(wheelColorToHex(hsv)).toBe(hex);
  });

  it("keeps the original RGB bytes for dark, desaturated and neutral custom tags", () => {
    for (const hex of [
      "#000000",
      "#FFFFFF",
      "#777777",
      "#112233",
      "#AB8A02",
      "#6D0366",
      "#01FF02",
    ]) {
      expect(wheelColorToHex(hexToWheelColor(hex))).toBe(hex);
    }
    expect(wheelColorToHex({ hue: 360, saturation: 60, brightness: 50 })).toBe(
      "#803333",
    );
  });

  it("uses clockwise screen coordinates and snaps out-of-disk drags to the perimeter", () => {
    expect(wheelColorAtPoint(0, 0)).toEqual({ hue: 0, saturation: 0 });
    expect(wheelColorAtPoint(0, 0.5)).toEqual({ hue: 90, saturation: 50 });
    expect(wheelColorAtPoint(0, -2)).toEqual({ hue: 270, saturation: 100 });
    const point = wheelColorPoint({ hue: 225, saturation: 50, brightness: 20 });
    expect(point.x).toBeCloseTo(-Math.SQRT1_2 / 2);
    expect(point.y).toBeCloseTo(-Math.SQRT1_2 / 2);
    const selected = wheelColorAtPoint(point.x, point.y);
    expect(selected.hue).toBeCloseTo(225);
    expect(selected.saturation).toBeCloseTo(50);
  });
});
