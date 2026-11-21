import { act, render } from "@testing-library/react";
import { Activity, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGradientBackgroundCanvas } from "./use-gradient-background-canvas";

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
  } as unknown as WebGLRenderingContext;
}

function Harness() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useGradientBackgroundCanvas(canvasRef);
  return <canvas ref={canvasRef} />;
}

describe("useGradientBackgroundCanvas", () => {
  let frameId = 0;
  const frames = new Map<number, FrameRequestCallback>();

  beforeEach(() => {
    frameId = 0;
    frames.clear();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function stubReducedMotion(matches: boolean) {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: matches && query === "(prefers-reduced-motion: reduce)",
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    );
  }

  it("does nothing when WebGL is unavailable", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    stubReducedMotion(false);
    render(<Harness />);
    expect(frames.size).toBe(0);
  });

  it("paints a single frame and responds to resize and theme changes under reduced motion", () => {
    const gl = createMockWebGLContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(gl);
    stubReducedMotion(true);

    let onResize: () => void = () => {};
    const resizeDisconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          onResize = callback;
        }
        observe() {}
        disconnect = resizeDisconnect;
      },
    );

    let onThemeMutate: () => void = () => {};
    const themeDisconnect = vi.fn();
    vi.stubGlobal(
      "MutationObserver",
      class {
        constructor(callback: () => void) {
          onThemeMutate = callback;
        }
        observe() {}
        disconnect = themeDisconnect;
      },
    );

    const { unmount } = render(<Harness />);

    expect(frames.size).toBe(0);
    expect(gl.drawArrays).toHaveBeenCalledTimes(1);

    act(() => onResize());
    expect(gl.drawArrays).toHaveBeenCalledTimes(2);

    act(() => onThemeMutate());
    expect(gl.drawArrays).toHaveBeenCalledTimes(3);

    unmount();
    expect(resizeDisconnect).toHaveBeenCalledTimes(1);
    expect(themeDisconnect).toHaveBeenCalledTimes(1);
  });

  it("runs a rAF loop, pauses off screen, and tears down cleanly across Activity hide and reveal", () => {
    const gl = createMockWebGLContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(gl);
    stubReducedMotion(false);

    let onIntersect: (entries: { isIntersecting: boolean }[]) => void =
      () => {};
    const visibilityDisconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(
          callback: (entries: { isIntersecting: boolean }[]) => void,
        ) {
          onIntersect = callback;
        }
        observe() {}
        disconnect = visibilityDisconnect;
      },
    );

    const themeDisconnect = vi.fn();
    vi.stubGlobal(
      "MutationObserver",
      class {
        observe() {}
        disconnect = themeDisconnect;
      },
    );

    const { rerender } = render(
      <Activity mode="visible">
        <Harness />
      </Activity>,
    );

    expect(frames.size).toBe(1);
    const runFrame = () => {
      const callbacks = [...frames.values()];
      frames.clear();
      act(() => {
        for (const cb of callbacks) cb(16);
      });
    };

    runFrame();
    expect(gl.drawArrays).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(1);

    // Off-screen stops scheduling further frames after the current tick.
    act(() => onIntersect([{ isIntersecting: false }]));
    runFrame();
    expect(frames.size).toBe(0);

    // Coming back on screen resumes the loop.
    act(() => onIntersect([{ isIntersecting: true }]));
    expect(frames.size).toBe(1);

    // Activity hide cancels rAF and disconnects observers.
    rerender(
      <Activity mode="hidden">
        <Harness />
      </Activity>,
    );
    expect(frames.size).toBe(0);
    expect(visibilityDisconnect).toHaveBeenCalledTimes(1);
    expect(themeDisconnect).toHaveBeenCalledTimes(1);

    // Activity reveal starts a fresh loop.
    rerender(
      <Activity mode="visible">
        <Harness />
      </Activity>,
    );
    expect(frames.size).toBe(1);
  });
});
