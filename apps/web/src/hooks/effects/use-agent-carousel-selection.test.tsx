import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AgentCarouselSelectionApi,
  type AgentCarouselSelectionState,
  useAgentCarouselSelection,
} from "./use-agent-carousel-selection";

function createFakeApi(initial: {
  snap: number;
  next: boolean;
  prev: boolean;
}) {
  let state = { ...initial };
  const listeners = new Set<() => void>();
  const on = vi.fn((event: "select", cb: () => void) => {
    if (event === "select") listeners.add(cb);
    return api;
  });
  const off = vi.fn((event: "select", cb: () => void) => {
    if (event === "select") listeners.delete(cb);
    return api;
  });

  const api: AgentCarouselSelectionApi = {
    on,
    off,
    selectedScrollSnap: () => state.snap,
    canScrollNext: () => state.next,
    canScrollPrev: () => state.prev,
  };

  return {
    api,
    on,
    off,
    emitSelect(nextState: { snap: number; next: boolean; prev: boolean }) {
      state = { ...nextState };
      for (const listener of listeners) listener();
    },
  };
}

describe("useAgentCarouselSelection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("subscribes to select, initializes via requestAnimationFrame, re-subscribes on api change, and unsubscribes on unmount", () => {
    const rafQueue: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });

    const captured: { value: AgentCarouselSelectionState | null } = {
      value: null,
    };

    function Probe({ api }: { api: AgentCarouselSelectionApi | undefined }) {
      captured.value = useAgentCarouselSelection(api);
      return null;
    }

    const { rerender, unmount } = render(<Probe api={undefined} />);
    expect(captured.value).toEqual({
      current: 0,
      canScrollNext: false,
      canScrollPrev: false,
    });
    expect(rafQueue).toHaveLength(0);

    const first = createFakeApi({ snap: 0, next: true, prev: false });
    rerender(<Probe api={first.api} />);
    expect(first.on).toHaveBeenCalledTimes(1);
    expect(rafQueue).toHaveLength(1);

    act(() => {
      rafQueue.shift()?.(16);
    });
    expect(captured.value).toEqual({
      current: 0,
      canScrollNext: true,
      canScrollPrev: false,
    });

    act(() => {
      first.emitSelect({ snap: 2, next: false, prev: true });
    });
    expect(captured.value).toEqual({
      current: 2,
      canScrollNext: false,
      canScrollPrev: true,
    });

    const second = createFakeApi({ snap: 1, next: true, prev: true });
    rerender(<Probe api={second.api} />);
    expect(first.off).toHaveBeenCalledTimes(1);
    expect(second.on).toHaveBeenCalledTimes(1);

    act(() => {
      rafQueue.shift()?.(32);
    });
    expect(captured.value).toEqual({
      current: 1,
      canScrollNext: true,
      canScrollPrev: true,
    });

    unmount();
    expect(second.off).toHaveBeenCalledTimes(1);
  });
});
