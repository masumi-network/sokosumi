import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCookieBannerChromeLeftPx } from "./use-cookie-banner-chrome-left";

describe("useCookieBannerChromeLeftPx", () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("measures the sidebar gap on mount, updates on ResizeObserver and window resize, and disconnects on unmount", () => {
    let gapWidth = 224;
    const gap = document.createElement("div");
    gap.setAttribute("data-slot", "sidebar-gap");
    vi.spyOn(gap, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, 0, gapWidth, 800),
    );
    document.body.appendChild(gap);

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1280,
    });

    const observers: Array<{
      observe: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      fire: () => void;
    }> = [];

    class FakeResizeObserver {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      constructor(private readonly cb: ResizeObserverCallback) {
        observers.push({
          observe: this.observe,
          disconnect: this.disconnect,
          fire: () => this.cb([], this),
        });
      }
    }

    globalThis.ResizeObserver = FakeResizeObserver;

    const captured = { leftPx: -1 };
    function Probe() {
      captured.leftPx = useCookieBannerChromeLeftPx();
      return null;
    }

    const { unmount } = render(<Probe />);
    expect(captured.leftPx).toBe(224);
    expect(observers).toHaveLength(1);
    expect(observers[0]?.observe).toHaveBeenCalledWith(gap);

    gapWidth = 64;
    act(() => {
      observers[0]?.fire();
    });
    expect(captured.leftPx).toBe(64);

    // Narrow viewport resets alignment to 0 on window resize.
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 500,
    });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(captured.leftPx).toBe(0);

    unmount();
    expect(observers[0]?.disconnect).toHaveBeenCalledTimes(1);
  });
});
