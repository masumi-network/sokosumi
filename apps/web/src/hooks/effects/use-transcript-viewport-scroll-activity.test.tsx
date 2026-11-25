import type { Virtualizer } from "@tanstack/react-virtual";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTranscriptViewportScrollActivity } from "./use-transcript-viewport-scroll-activity";

function createHarness() {
  const scroller = document.body.appendChild(document.createElement("div"));
  const inner = scroller.appendChild(document.createElement("div"));
  const virtualizer = { isScrolling: false } as Virtualizer<
    HTMLElement,
    HTMLDivElement
  >;
  const touchingRef = { current: false };
  const scrollingRef = { current: false };
  const recordDistance = vi.fn();
  const followResize = vi.fn(() => false);
  const onScrollIdle = vi.fn();
  return {
    scroller,
    inner,
    virtualizer,
    touchingRef,
    scrollingRef,
    recordDistance,
    followResize,
    onScrollIdle,
  };
}

describe("useTranscriptViewportScrollActivity", () => {
  let resizeCallbacks: ResizeObserverCallback[] = [];
  const observedElements: Array<[Element, ResizeObserverOptions | undefined]> =
    [];
  const disconnected = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    resizeCallbacks = [];
    observedElements.length = 0;
    disconnected.mockClear();
    vi.stubGlobal(
      "ResizeObserver",
      class MockResizeObserver {
        constructor(cb: ResizeObserverCallback) {
          resizeCallbacks.push(cb);
        }
        observe(el: Element, options?: ResizeObserverOptions) {
          observedElements.push([el, options]);
        }
        unobserve() {}
        disconnect() {
          disconnected();
        }
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("waits the full 200ms idle delay before calling onScrollIdle", () => {
    const h = createHarness();
    renderHook(() => useTranscriptViewportScrollActivity(h));

    h.scroller.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(199);
    expect(h.scrollingRef.current).toBe(true);
    expect(h.onScrollIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(h.scrollingRef.current).toBe(false);
    expect(h.onScrollIdle).toHaveBeenCalledOnce();
  });

  it("records scroll activity and waits for momentum to settle before calling onScrollIdle", () => {
    const h = createHarness();
    renderHook(() => useTranscriptViewportScrollActivity(h));

    h.virtualizer.isScrolling = true;
    h.scroller.dispatchEvent(new Event("scroll"));
    expect(h.scrollingRef.current).toBe(true);
    expect(h.recordDistance).toHaveBeenCalledExactlyOnceWith(h.scroller);

    // Still scrolling after 200ms: reschedules instead of settling.
    vi.advanceTimersByTime(200);
    expect(h.scrollingRef.current).toBe(true);
    expect(h.onScrollIdle).not.toHaveBeenCalled();

    h.virtualizer.isScrolling = false;
    vi.advanceTimersByTime(200);
    expect(h.scrollingRef.current).toBe(false);
    expect(h.onScrollIdle).toHaveBeenCalledOnce();

    // scrollend schedules another settle once idle.
    h.scrollingRef.current = true;
    h.scroller.dispatchEvent(new Event("scrollend"));
    vi.advanceTimersByTime(200);
    expect(h.scrollingRef.current).toBe(false);
    expect(h.onScrollIdle).toHaveBeenCalledTimes(2);
  });

  it("holds idle during touch, settles after touchend/touchcancel, and blurs only external composers", () => {
    const h = createHarness();
    renderHook(() => useTranscriptViewportScrollActivity(h));

    const externalComposer = document.body.appendChild(
      document.createElement("div"),
    );
    externalComposer.setAttribute("contenteditable", "true");
    externalComposer.tabIndex = 0;
    const inlineEditor = h.scroller.appendChild(document.createElement("div"));
    inlineEditor.setAttribute("contenteditable", "true");
    inlineEditor.tabIndex = 0;

    // Touch holds scrolling active and prevents idle timer from firing.
    h.scroller.dispatchEvent(new Event("touchstart"));
    expect(h.touchingRef.current).toBe(true);
    expect(h.scrollingRef.current).toBe(true);
    vi.advanceTimersByTime(400);
    expect(h.onScrollIdle).not.toHaveBeenCalled();

    // Dragging blurs external composer but leaves in-scroller edit focused.
    externalComposer.focus();
    const externalBlur = vi.spyOn(externalComposer, "blur");
    h.scroller.dispatchEvent(new Event("touchmove"));
    expect(externalBlur).toHaveBeenCalledOnce();

    inlineEditor.focus();
    const inlineBlur = vi.spyOn(inlineEditor, "blur");
    h.scroller.dispatchEvent(new Event("touchmove"));
    expect(inlineBlur).not.toHaveBeenCalled();

    // touchend releases touch and settles after 200ms.
    h.scroller.dispatchEvent(new Event("touchend"));
    expect(h.touchingRef.current).toBe(false);
    vi.advanceTimersByTime(200);
    expect(h.scrollingRef.current).toBe(false);
    expect(h.onScrollIdle).toHaveBeenCalledOnce();

    // touchcancel also releases touch and settles.
    h.scroller.dispatchEvent(new Event("touchstart"));
    h.scroller.dispatchEvent(new Event("touchcancel"));
    expect(h.touchingRef.current).toBe(false);
    vi.advanceTimersByTime(200);
    expect(h.onScrollIdle).toHaveBeenCalledTimes(2);
  });

  it("observes scroller and list resize, and cleans up timers and listeners on unmount", () => {
    const h = createHarness();
    const { unmount } = renderHook(() =>
      useTranscriptViewportScrollActivity(h),
    );

    expect(observedElements).toEqual([
      [h.scroller, undefined],
      [h.inner, { box: "border-box" }],
    ]);

    resizeCallbacks[0]?.([], {} as ResizeObserver);
    expect(h.followResize).toHaveBeenCalledExactlyOnceWith(h.scroller);
    expect(h.recordDistance).toHaveBeenCalledExactlyOnceWith(h.scroller);

    h.followResize.mockReturnValueOnce(true);
    h.recordDistance.mockClear();
    resizeCallbacks[0]?.([], {} as ResizeObserver);
    expect(h.recordDistance).not.toHaveBeenCalled();

    // Pending idle timer and listeners do not fire after unmount.
    h.scroller.dispatchEvent(new Event("scroll"));
    h.recordDistance.mockClear();
    unmount();
    expect(disconnected).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(500);
    h.scroller.dispatchEvent(new Event("scroll"));
    expect(h.onScrollIdle).not.toHaveBeenCalled();
    expect(h.recordDistance).not.toHaveBeenCalled();
  });
});
