import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STICK_TO_BOTTOM_NEAR_PX,
  useStickToBottom,
} from "../use-stick-to-bottom";

type ResizeObserverCallback = (
  entries: ResizeObserverEntry[],
  observer: ResizeObserver,
) => void;

const observerCallbacks = new Set<ResizeObserverCallback>();

class ResizeObserverMock {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    observerCallbacks.add(callback);
  }

  observe(_target: Element) {}

  disconnect() {
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

function Harness({ resetKey }: { resetKey: string | null }) {
  const { scrollerRef, contentRef, scrollToBottomIfPinned, contentMinHeight } =
    useStickToBottom({
      resetKey,
    });

  return (
    <div>
      <div ref={scrollerRef} data-testid="scroller">
        <div
          ref={contentRef}
          data-testid="content"
          style={
            contentMinHeight != null
              ? { minHeight: contentMinHeight }
              : undefined
          }
        />
      </div>
      <button type="button" onClick={scrollToBottomIfPinned}>
        pin-scroll
      </button>
    </div>
  );
}

describe("useStickToBottom", () => {
  beforeEach(() => {
    observerCallbacks.clear();
    global.ResizeObserver =
      ResizeObserverMock as unknown as typeof global.ResizeObserver;
  });

  afterEach(() => {
    observerCallbacks.clear();
  });

  it("pins the viewport on content resize while sticky", () => {
    render(<Harness resetKey="room-1" />);
    const scroller = screen.getByTestId("scroller");
    setScrollerMetrics(scroller, {
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 600,
    });

    act(() => {
      fireResize();
    });

    // jsdom does not clamp scrollTop; hook assigns scrollHeight.
    expect(scroller.scrollTop).toBe(1000);
  });

  it("does not pin on resize after the user scrolls away", () => {
    render(<Harness resetKey="room-1" />);
    const scroller = screen.getByTestId("scroller");
    setScrollerMetrics(scroller, {
      scrollHeight: 1000,
      clientHeight: 400,
      // distance = 400 >= NEAR
      scrollTop: 200,
    });
    act(() => {
      scroller.dispatchEvent(new Event("scroll"));
    });

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
    render(<Harness resetKey="room-1" />);
    const scroller = screen.getByTestId("scroller");
    setScrollerMetrics(scroller, {
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 550,
    });
    act(() => {
      scroller.dispatchEvent(new Event("scroll"));
    });

    setScrollerMetrics(scroller, {
      scrollHeight: 1000 + STICK_TO_BOTTOM_NEAR_PX + 50,
      clientHeight: 400,
      scrollTop: 550,
    });
    act(() => {
      fireResize();
    });

    expect(scroller.scrollTop).toBe(1000 + STICK_TO_BOTTOM_NEAR_PX + 50);
  });

  it("scrollToBottomIfPinned no-ops when unpinned", () => {
    render(<Harness resetKey="room-1" />);
    const scroller = screen.getByTestId("scroller");
    setScrollerMetrics(scroller, {
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 50,
    });
    act(() => {
      scroller.dispatchEvent(new Event("scroll"));
    });

    act(() => {
      screen.getByRole("button", { name: "pin-scroll" }).click();
    });

    expect(scroller.scrollTop).toBe(50);
  });

  it("mirrors scroller clientHeight onto content minHeight for short transcripts", () => {
    render(<Harness resetKey="room-1" />);
    const scroller = screen.getByTestId("scroller");
    const content = screen.getByTestId("content");
    setScrollerMetrics(scroller, {
      scrollHeight: 200,
      clientHeight: 565,
      scrollTop: 0,
    });

    act(() => {
      fireResize();
    });

    expect(content.style.minHeight).toBe("565px");
  });

  it("re-pins on resetKey change", async () => {
    const { rerender } = render(<Harness resetKey="room-1" />);
    const scroller = screen.getByTestId("scroller");
    setScrollerMetrics(scroller, {
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 50,
    });
    act(() => {
      scroller.dispatchEvent(new Event("scroll"));
    });

    setScrollerMetrics(scroller, {
      scrollHeight: 1200,
      clientHeight: 400,
      scrollTop: 50,
    });

    await act(async () => {
      rerender(<Harness resetKey="room-2" />);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(scroller.scrollTop).toBe(1200);
  });
});
