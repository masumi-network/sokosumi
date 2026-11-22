import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useJobsTwoPaneFitObserver } from "./use-jobs-two-pane-fit-observer";

describe("useJobsTwoPaneFitObserver", () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("observes the marked jobs panes row, updates fit state from contentRect.width, and disconnects on unmount", () => {
    const row = document.createElement("div");
    row.setAttribute("data-jobs-panes", "");
    document.body.appendChild(row);

    const observers: Array<{
      observe: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      fire: (width: number) => void;
    }> = [];

    class FakeResizeObserver {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      constructor(private readonly cb: ResizeObserverCallback) {
        observers.push({
          observe: this.observe,
          disconnect: this.disconnect,
          fire: (width: number) => {
            this.cb(
              [
                {
                  contentRect: new DOMRectReadOnly(0, 0, width, 600),
                } as ResizeObserverEntry,
              ],
              this,
            );
          },
        });
      }
    }

    globalThis.ResizeObserver = FakeResizeObserver;

    const captured: { fits: boolean | null } = { fits: null };
    function Probe() {
      captured.fits = useJobsTwoPaneFitObserver("data-jobs-panes", 896);
      return null;
    }

    const { unmount } = render(<Probe />);
    expect(captured.fits).toBeNull();
    expect(observers).toHaveLength(1);
    expect(observers[0]?.observe).toHaveBeenCalledWith(row);

    act(() => {
      observers[0]?.fire(895);
    });
    expect(captured.fits).toBe(false);

    act(() => {
      observers[0]?.fire(896);
    });
    expect(captured.fits).toBe(true);

    unmount();
    expect(observers[0]?.disconnect).toHaveBeenCalledTimes(1);
  });
});
