import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cssColorToRgb, FoilBackground } from "./foil-background";

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

describe("cssColorToRgb", () => {
  it("reads a token's hex value as 0–1 channels", () => {
    expect(cssColorToRgb(" #ff0080 ")).toEqual([1, 0, 128 / 255]);
  });

  it("falls back to black for anything else", () => {
    expect(cssColorToRgb("")).toEqual([0, 0, 0]);
    expect(cssColorToRgb("rgb(1 2 3)")).toEqual([0, 0, 0]);
  });
});
