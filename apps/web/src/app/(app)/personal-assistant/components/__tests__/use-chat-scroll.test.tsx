import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JUMP_TO_LATEST_PX, NEAR_BOTTOM_PX } from "../running-state/constants";
import type { Message } from "../running-state/types";
import { useChatScroll } from "../running-state/use-chat-scroll";

type ResizeObserverCallback = (
  entries: ResizeObserverEntry[],
  observer: ResizeObserver,
) => void;

const observerCallbacks = new Set<ResizeObserverCallback>();
const observeSpy = vi.fn();
const disconnectSpy = vi.fn();

class ResizeObserverMock {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    observerCallbacks.add(callback);
  }

  observe(target: Element) {
    observeSpy(target);
  }

  disconnect() {
    disconnectSpy();
    observerCallbacks.delete(this.callback);
  }

  unobserve() {}
}

function fireResize() {
  for (const callback of observerCallbacks) {
    callback([], {} as ResizeObserver);
  }
}

function setScrollerMetrics(
  el: HTMLElement,
  {
    scrollHeight,
    clientHeight,
    scrollTop,
  }: {
    scrollHeight: number;
    clientHeight: number;
    scrollTop: number;
  },
) {
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    get: () => clientHeight,
  });
  el.scrollTop = scrollTop;
}

interface HarnessProps {
  messages: Message[];
  isReplying: boolean;
  streamingId: string | null;
  isEmpty: boolean;
}

function Harness({ messages, isReplying, streamingId, isEmpty }: HarnessProps) {
  const { scrollerRef, atBottom, handleScrollerScroll, scrollToBottom } =
    useChatScroll({
      messages,
      isReplying,
      streamingId,
      isEmpty,
    });

  return (
    <div>
      <div
        ref={scrollerRef}
        data-testid="scroller"
        onScroll={handleScrollerScroll}
      >
        <div data-testid="content" />
      </div>
      <button type="button" onClick={scrollToBottom}>
        jump
      </button>
      <span data-testid="at-bottom">{atBottom ? "yes" : "no"}</span>
    </div>
  );
}

const baseMessage: Message = {
  id: "m1",
  role: "assistant",
  content: "hello",
  kind: null,
  createdAt: new Date().toISOString(),
};

describe("useChatScroll", () => {
  beforeEach(() => {
    observerCallbacks.clear();
    observeSpy.mockClear();
    disconnectSpy.mockClear();
    global.ResizeObserver =
      ResizeObserverMock as unknown as typeof global.ResizeObserver;
  });

  afterEach(() => {
    observerCallbacks.clear();
  });

  it("pins the viewport on content resize while sticky", () => {
    render(
      <Harness
        messages={[baseMessage]}
        isReplying={false}
        streamingId={null}
        isEmpty={false}
      />,
    );

    const scroller = screen.getByTestId("scroller");
    setScrollerMetrics(scroller, {
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 600,
    });

    // distance = 0 → still sticky from initial ref
    act(() => {
      fireResize();
    });

    expect(scroller.scrollTop).toBe(1000);
  });

  it("does not hijack scroll when the user has scrolled up past NEAR_BOTTOM_PX", () => {
    render(
      <Harness
        messages={[baseMessage]}
        isReplying={false}
        streamingId={null}
        isEmpty={false}
      />,
    );

    const scroller = screen.getByTestId("scroller");
    setScrollerMetrics(scroller, {
      scrollHeight: 1000,
      clientHeight: 400,
      // distance = 1000 - 200 - 400 = 400 >= NEAR_BOTTOM_PX
      scrollTop: 200,
    });

    fireEvent.scroll(scroller);

    const scrollTopBefore = scroller.scrollTop;
    setScrollerMetrics(scroller, {
      scrollHeight: 1400,
      clientHeight: 400,
      scrollTop: scrollTopBefore,
    });

    act(() => {
      fireResize();
    });

    expect(scroller.scrollTop).toBe(scrollTopBefore);
  });

  it("keeps following after a large content jump when still sticky", () => {
    render(
      <Harness
        messages={[baseMessage]}
        isReplying={false}
        streamingId={null}
        isEmpty={false}
      />,
    );

    const scroller = screen.getByTestId("scroller");
    // Near bottom but not exact: distance = 50 < NEAR_BOTTOM_PX
    setScrollerMetrics(scroller, {
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 550,
    });
    fireEvent.scroll(scroller);

    // Content grows by more than NEAR_BOTTOM_PX in one frame. A post-resize
    // distance check would look "scrolled up"; the sticky flag must not.
    setScrollerMetrics(scroller, {
      scrollHeight: 1000 + NEAR_BOTTOM_PX + 50,
      clientHeight: 400,
      scrollTop: 550,
    });

    act(() => {
      fireResize();
    });

    expect(scroller.scrollTop).toBe(1000 + NEAR_BOTTOM_PX + 50);
  });

  it("re-attaches the ResizeObserver when isEmpty flips", () => {
    const { rerender } = render(
      <Harness
        messages={[]}
        isReplying={false}
        streamingId={null}
        isEmpty={true}
      />,
    );

    expect(observeSpy).toHaveBeenCalledTimes(1);
    const firstTarget = observeSpy.mock.calls[0]?.[0];

    rerender(
      <Harness
        messages={[baseMessage]}
        isReplying={false}
        streamingId={null}
        isEmpty={false}
      />,
    );

    expect(disconnectSpy).toHaveBeenCalled();
    expect(observeSpy).toHaveBeenCalledTimes(2);
    expect(observeSpy.mock.calls[1]?.[0]).toBeDefined();
    // Same content node identity is fine; the point is a fresh observe after
    // disconnect when the Welcome ↔ Timeline swap flips isEmpty.
    expect(observeSpy.mock.calls[1]?.[0]).toBe(firstTarget);
  });

  it("follows streamed content growth only while sticky", () => {
    const { rerender } = render(
      <Harness
        messages={[{ ...baseMessage, content: "hi" }]}
        isReplying={true}
        streamingId="m1"
        isEmpty={false}
      />,
    );

    const scroller = screen.getByTestId("scroller");
    setScrollerMetrics(scroller, {
      scrollHeight: 800,
      clientHeight: 400,
      scrollTop: 100,
    });
    // distance = 300 >= NEAR_BOTTOM_PX → unstick
    fireEvent.scroll(scroller);

    const before = scroller.scrollTop;
    rerender(
      <Harness
        messages={[{ ...baseMessage, content: "hi there, longer text" }]}
        isReplying={true}
        streamingId="m1"
        isEmpty={false}
      />,
    );

    expect(scroller.scrollTop).toBe(before);

    // Jump to latest restores stickiness
    setScrollerMetrics(scroller, {
      scrollHeight: 900,
      clientHeight: 400,
      scrollTop: before,
    });
    fireEvent.click(screen.getByRole("button", { name: "jump" }));
    expect(scroller.scrollTop).toBe(900);

    setScrollerMetrics(scroller, {
      scrollHeight: 1100,
      clientHeight: 400,
      scrollTop: 900,
    });
    rerender(
      <Harness
        messages={[
          { ...baseMessage, content: "hi there, longer text and more" },
        ]}
        isReplying={true}
        streamingId="m1"
        isEmpty={false}
      />,
    );
    expect(scroller.scrollTop).toBe(1100);
  });

  it("uses JUMP_TO_LATEST_PX for the jump-to-latest control visibility", () => {
    render(
      <Harness
        messages={[baseMessage]}
        isReplying={false}
        streamingId={null}
        isEmpty={false}
      />,
    );

    const scroller = screen.getByTestId("scroller");
    // Between JUMP_TO_LATEST_PX and NEAR_BOTTOM_PX: still sticky, but show
    // jump control.
    const distance = Math.floor((JUMP_TO_LATEST_PX + NEAR_BOTTOM_PX) / 2);
    setScrollerMetrics(scroller, {
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 1000 - 400 - distance,
    });
    fireEvent.scroll(scroller);

    expect(screen.getByTestId("at-bottom")).toHaveTextContent("no");
    expect(distance).toBeGreaterThanOrEqual(JUMP_TO_LATEST_PX);
    expect(distance).toBeLessThan(NEAR_BOTTOM_PX);

    // Resize still follows because sticky uses NEAR_BOTTOM_PX.
    setScrollerMetrics(scroller, {
      scrollHeight: 1200,
      clientHeight: 400,
      scrollTop: 1000 - 400 - distance,
    });
    act(() => {
      fireResize();
    });
    expect(scroller.scrollTop).toBe(1200);
  });
});
