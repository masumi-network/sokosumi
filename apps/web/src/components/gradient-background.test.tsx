import { act, render } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cssColorToRgb, gradientLoopAt } from "@/lib/gradient-background";
import { GradientBackground } from "./gradient-background";

function createMockWebGLContext() {
  return {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    LINK_STATUS: 0x8b82,
    TRIANGLE_STRIP: 0x0005,
    createProgram: vi.fn(() => ({})),
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    useProgram: vi.fn(),
    createBuffer: vi.fn(() => ({})),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    getUniformLocation: vi.fn(() => ({})),
    uniform1f: vi.fn(),
    uniform3f: vi.fn(),
    viewport: vi.fn(),
    drawArrays: vi.fn(),
    deleteBuffer: vi.fn(),
    deleteProgram: vi.fn(),
    deleteShader: vi.fn(),
  } as unknown as WebGLRenderingContext;
}

describe("GradientBackground", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is a decorative canvas that draws nothing without WebGL", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const { container } = render(<GradientBackground className="h-10" />);
    const box = container.firstElementChild;
    expect(box).toHaveAttribute("aria-hidden", "true");
    expect(box).toHaveClass("pointer-events-none", "h-10");
    expect(box?.querySelector("canvas")).toHaveClass("size-full");
  });

  it("paints a single static frame without animating after SSR hydration under reduced motion", async () => {
    const gl = createMockWebGLContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(gl);
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(() => 1);
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    );

    const container = document.createElement("div");
    container.innerHTML = renderToString(<GradientBackground />);
    document.body.append(container);

    let root: Root | null = null;
    try {
      await act(async () => {
        root = hydrateRoot(container, <GradientBackground />);
      });
      expect(gl.drawArrays).toHaveBeenCalled();
      expect(rafSpy).not.toHaveBeenCalled();
    } finally {
      await act(async () => root?.unmount());
      container.remove();
    }
  });
});

describe("gradientLoopAt", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("follows the wall clock, so a remount carries on where the gradient was", () => {
    vi.useFakeTimers();
    vi.setSystemTime(60_000);
    expect(gradientLoopAt(false)).toBe(0.25);
  });

  it("comes back to the start after one turn, with no jump", () => {
    vi.useFakeTimers();
    vi.setSystemTime(240_000 * 7 - 1);
    expect(gradientLoopAt(false)).toBeCloseTo(1, 4);
    vi.setSystemTime(240_000 * 7);
    expect(gradientLoopAt(false)).toBe(0);
  });

  it("holds still under reduced motion", () => {
    vi.useFakeTimers();
    vi.setSystemTime(60_000);
    expect(gradientLoopAt(true)).toBe(0);
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
