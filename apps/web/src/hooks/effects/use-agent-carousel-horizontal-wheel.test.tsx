import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAgentCarouselHorizontalWheel } from "./use-agent-carousel-horizontal-wheel";

describe("useAgentCarouselHorizontalWheel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accumulates horizontal desktop wheel deltas into rAF scrollLeft updates and cancels pending rAF on cleanup", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1280,
    });

    const rafCallbacks = new Map<number, FrameRequestCallback>();
    let nextRafId = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      const id = nextRafId++;
      rafCallbacks.set(id, cb);
      return id;
    });
    const cancelSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((id) => {
        rafCallbacks.delete(id);
      });

    function Probe({ api }: { api: object | undefined }) {
      const carouselRef = useRef<HTMLDivElement>(null);
      useAgentCarouselHorizontalWheel(carouselRef, api);
      return (
        <div ref={carouselRef} data-testid="carousel">
          <div data-slot="carousel-content" data-testid="content" />
        </div>
      );
    }

    const apiA = { id: "a" };
    const { rerender, unmount } = render(<Probe api={undefined} />);
    const carousel = screen.getByTestId("carousel");
    const content = screen.getByTestId("content");

    // Without api, wheel events are ignored.
    const ignored = new WheelEvent("wheel", {
      deltaX: 40,
      deltaY: 0,
      cancelable: true,
    });
    carousel.dispatchEvent(ignored);
    expect(ignored.defaultPrevented).toBe(false);
    expect(rafCallbacks.size).toBe(0);

    rerender(<Probe api={apiA} />);

    // Vertical wheel passes through without preventDefault.
    const vertical = new WheelEvent("wheel", {
      deltaX: 5,
      deltaY: 50,
      cancelable: true,
    });
    carousel.dispatchEvent(vertical);
    expect(vertical.defaultPrevented).toBe(false);

    // Multiple horizontal wheel ticks coalesce into one rAF scroll update.
    const h1 = new WheelEvent("wheel", {
      deltaX: 30,
      deltaY: 2,
      cancelable: true,
    });
    const h2 = new WheelEvent("wheel", {
      deltaX: 25,
      deltaY: 0,
      cancelable: true,
    });
    carousel.dispatchEvent(h1);
    carousel.dispatchEvent(h2);
    expect(h1.defaultPrevented).toBe(true);
    expect(h2.defaultPrevented).toBe(true);
    expect(rafCallbacks.size).toBe(1);

    const [[rafId, cb]] = Array.from(rafCallbacks.entries());
    rafCallbacks.delete(rafId);
    cb(16);
    expect(content.scrollLeft).toBe(55);

    // Queue another frame and unmount before it runs: cleanup cancels rAF.
    carousel.dispatchEvent(
      new WheelEvent("wheel", { deltaX: 20, deltaY: 0, cancelable: true }),
    );
    expect(rafCallbacks.size).toBe(1);
    const pendingId = Array.from(rafCallbacks.keys())[0];

    unmount();
    expect(cancelSpy).toHaveBeenCalledWith(pendingId);
  });
});
