import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cssColorToRgb, FoilBackground, foilLoopAt } from "./foil-background";

describe("FoilBackground", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is a decorative canvas that draws nothing without WebGL", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const { container } = render(<FoilBackground className="h-10" />);
    const canvas = container.querySelector("canvas");
    expect(canvas).toHaveAttribute("aria-hidden", "true");
    expect(canvas).toHaveClass("pointer-events-none", "h-10");
  });
});

describe("foilLoopAt", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("follows the wall clock, so a remount carries on where the foil was", () => {
    vi.useFakeTimers();
    vi.setSystemTime(60_000);
    expect(foilLoopAt(false)).toBe(0.25);
  });

  it("comes back to the start after one turn, with no jump", () => {
    vi.useFakeTimers();
    vi.setSystemTime(240_000 * 7 - 1);
    expect(foilLoopAt(false)).toBeCloseTo(1, 4);
    vi.setSystemTime(240_000 * 7);
    expect(foilLoopAt(false)).toBe(0);
  });

  it("holds still under reduced motion", () => {
    vi.useFakeTimers();
    vi.setSystemTime(60_000);
    expect(foilLoopAt(true)).toBe(0);
  });
});

describe("cssColorToRgb", () => {
  it("reads a token's hex value as 0–1 channels", () => {
    expect(cssColorToRgb(" #ff0080 ")).toEqual([1, 0, 128 / 255]);
  });

  it("falls back to black for anything else", () => {
    expect(cssColorToRgb("")).toEqual([0, 0, 0]);
    expect(cssColorToRgb("rgb(1 2 3)")).toEqual([0, 0, 0]);
  });
});
