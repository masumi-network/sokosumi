import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockIsPresent = true;
const mockSafeToRemove = vi.fn();
let mockReduceMotion = false;

vi.mock("motion/react", () => ({
  usePresence: () => [mockIsPresent, mockSafeToRemove] as const,
}));

vi.mock("./use-media-query", () => ({
  usePrefersReducedMotion: () => mockReduceMotion,
}));

import { useRoomPanelSlideOut } from "./use-room-panel-slide-out";

function makePanel(offsetWidth: number) {
  const panel = document.createElement("div");
  Object.defineProperty(panel, "offsetWidth", {
    configurable: true,
    value: offsetWidth,
  });
  let onfinish: ((this: Animation, ev: AnimationPlaybackEvent) => void) | null =
    null;
  const cancel = vi.fn();
  const animation = Object.assign(
    Object.create(Animation.prototype) as Animation,
    {
      cancel,
    },
  );
  Object.defineProperty(animation, "onfinish", {
    configurable: true,
    get: () => onfinish,
    set: (value) => {
      onfinish = value;
    },
  });
  const animate = vi.fn(() => animation);
  panel.animate = animate;
  return {
    panel,
    animate,
    cancel,
    finish: () => {
      onfinish?.call(animation, new Event("finish") as AnimationPlaybackEvent);
    },
  };
}

describe("useRoomPanelSlideOut", () => {
  beforeEach(() => {
    mockIsPresent = true;
    mockReduceMotion = false;
    mockSafeToRemove.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("animates the panel out on exit and removes it on finish", () => {
    const { panel, animate, cancel, finish } = makePanel(320);
    const ref = createRef<HTMLDivElement>();
    ref.current = panel;

    const { result, rerender, unmount } = renderHook(() =>
      useRoomPanelSlideOut(ref),
    );
    expect(result.current).toBe(true);
    expect(animate).not.toHaveBeenCalled();
    expect(mockSafeToRemove).not.toHaveBeenCalled();

    mockIsPresent = false;
    rerender();

    expect(result.current).toBe(false);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(mockSafeToRemove).not.toHaveBeenCalled();

    act(() => {
      finish();
    });
    expect(mockSafeToRemove).toHaveBeenCalledTimes(1);

    unmount();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("removes immediately without animating when reduced motion is enabled", () => {
    mockReduceMotion = true;
    const { panel, animate } = makePanel(320);
    const ref = createRef<HTMLDivElement>();
    ref.current = panel;

    mockIsPresent = false;
    renderHook(() => useRoomPanelSlideOut(ref));

    expect(animate).not.toHaveBeenCalled();
    expect(mockSafeToRemove).toHaveBeenCalledTimes(1);
  });

  it("removes immediately without animating when the panel has no layout width", () => {
    const { panel, animate } = makePanel(0);
    const ref = createRef<HTMLDivElement>();
    ref.current = panel;

    mockIsPresent = false;
    renderHook(() => useRoomPanelSlideOut(ref));

    expect(animate).not.toHaveBeenCalled();
    expect(mockSafeToRemove).toHaveBeenCalledTimes(1);
  });
});
