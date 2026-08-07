import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetVisualViewportKeyboardBaseline } from "@/lib/utils/visual-viewport-keyboard";

import { useKeyboardOpen } from "../use-keyboard-open";

interface VisualViewportStub {
  height: number;
  offsetTop: number;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  dispatch: (type: string) => void;
}

function stubVisualViewport(height: number, offsetTop = 0): VisualViewportStub {
  const listeners = new Map<string, Set<() => void>>();
  const stub: VisualViewportStub = {
    height,
    offsetTop,
    addEventListener: vi.fn((type: string, listener: () => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    }),
    removeEventListener: vi.fn((type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener);
    }),
    dispatch(type: string) {
      for (const listener of listeners.get(type) ?? []) {
        listener();
      }
    },
  };

  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    writable: true,
    value: stub,
  });

  return stub;
}

describe("useKeyboardOpen", () => {
  const originalInnerHeight = window.innerHeight;
  const originalVisualViewport = window.visualViewport;

  afterEach(() => {
    resetVisualViewportKeyboardBaseline();
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: originalInnerHeight,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      writable: true,
      value: originalVisualViewport,
    });
    vi.restoreAllMocks();
  });

  it("is false when visualViewport is unavailable", () => {
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const { result } = renderHook(() => useKeyboardOpen());
    expect(result.current).toBe(false);
  });

  it("is false when the layout/visual delta is small", () => {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 800,
    });
    stubVisualViewport(700);

    const { result } = renderHook(() => useKeyboardOpen());
    expect(result.current).toBe(false);
  });

  it("is true when the soft keyboard shrinks visualViewport", () => {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 800,
    });
    stubVisualViewport(400);

    const { result } = renderHook(() => useKeyboardOpen());
    expect(result.current).toBe(true);
  });

  it("updates on visualViewport resize", () => {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 800,
    });
    const vv = stubVisualViewport(800);

    const { result } = renderHook(() => useKeyboardOpen());
    expect(result.current).toBe(false);

    act(() => {
      vv.height = 400;
      vv.dispatch("resize");
    });

    expect(result.current).toBe(true);
  });
});
