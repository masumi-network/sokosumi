import { act, render } from "@testing-library/react";
import { Activity, useRef } from "react";
import type { OrbState } from "thinking-orbs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useThinkingOrbCanvas } from "./use-thinking-orb-canvas";

const drawMock = vi.hoisted(() => vi.fn());
const resolvePresetMock = vi.hoisted(() =>
  vi.fn(() => ({ mode: "rings" as const, speed: 1, opts: {} })),
);

vi.mock("thinking-orbs", () => ({
  MODE_DRAWS: { rings: drawMock },
  resolvePreset: resolvePresetMock,
}));

function createMock2dContext() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    globalCompositeOperation: "source-over",
    fillStyle: "",
  } as unknown as CanvasRenderingContext2D;
}

function Harness({
  size = 32,
  state = "solving",
}: {
  size?: number;
  state?: OrbState;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useThinkingOrbCanvas(canvasRef, {
    size,
    state,
    fallbackColor: "rgb(255, 81, 255)",
  });
  return <canvas ref={canvasRef} />;
}

describe("useThinkingOrbCanvas", () => {
  let frameId = 0;
  const frames = new Map<number, FrameRequestCallback>();

  beforeEach(() => {
    frameId = 0;
    frames.clear();
    drawMock.mockReset();
    resolvePresetMock.mockClear();
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

  it("draws a single static frame at t=0 under reduced motion and caps DPR at 2", () => {
    const ctx = createMock2dContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    vi.stubGlobal("devicePixelRatio", 3);
    stubReducedMotion(true);

    const { container, rerender } = render(
      <Harness size={20} state="solving" />,
    );
    const canvas = container.querySelector("canvas")!;

    expect(canvas.width).toBe(40);
    expect(canvas.height).toBe(40);
    expect(frames.size).toBe(0);
    expect(drawMock).toHaveBeenCalledTimes(1);
    expect(drawMock).toHaveBeenLastCalledWith(ctx, 20, 0, false, {});
    expect(ctx.fillStyle).toBe("rgb(255, 81, 255)");

    rerender(<Harness size={32} state="searching" />);
    expect(canvas.width).toBe(128);
    expect(canvas.height).toBe(128);
    expect(resolvePresetMock).toHaveBeenLastCalledWith("searching", 64);
  });

  it("runs a rAF loop and cancels cleanly on Activity hide and unmount", () => {
    const ctx = createMock2dContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    stubReducedMotion(false);

    const { rerender, unmount } = render(
      <Activity mode="visible">
        <Harness size={32} state="solving" />
      </Activity>,
    );

    expect(frames.size).toBe(1);
    const callbacks = [...frames.values()];
    frames.clear();
    act(() => {
      for (const cb of callbacks) cb(performance.now() + 500);
    });
    expect(drawMock).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(1);

    rerender(
      <Activity mode="hidden">
        <Harness size={32} state="solving" />
      </Activity>,
    );
    expect(frames.size).toBe(0);

    rerender(
      <Activity mode="visible">
        <Harness size={32} state="solving" />
      </Activity>,
    );
    expect(frames.size).toBe(1);

    unmount();
    expect(frames.size).toBe(0);
  });
});
