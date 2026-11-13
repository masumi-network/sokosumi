import { act, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RoomShellLayout } from "./room-shell-layout";

const observations = new Map<Element, () => void>();
let composerHeight = 100;

beforeEach(() => {
  composerHeight = 100;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: () => void) {}
      observe(target: Element) {
        observations.set(target, this.callback);
      }
      disconnect() {
        for (const [target, callback] of observations) {
          if (callback === this.callback) observations.delete(target);
        }
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.querySelector('[data-testid="composer"]')
        ? composerHeight
        : 0;
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  observations.clear();
});

function renderShell() {
  const scrollerRef = createRef<HTMLDivElement>();
  const result = render(
    <RoomShellLayout
      listScrollerRef={scrollerRef}
      listContent={<button type="button">Message</button>}
      composer={<div data-testid="composer">Composer</div>}
    />,
  );
  const scroller = scrollerRef.current!;
  const wrapper = scroller.parentElement!;
  const slot = result.getByTestId("composer").parentElement!;
  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, value: 500 },
    scrollHeight: {
      configurable: true,
      get: () =>
        1000 +
        Number.parseFloat(wrapper.style.getPropertyValue("--room-composer-h")),
    },
  });
  return { ...result, scroller, wrapper, slot };
}

describe("RoomShellLayout composer overlay", () => {
  it("overlays a click-through composer slot and reserves its measured height before paint", () => {
    const { scroller, wrapper, slot } = renderShell();
    expect(wrapper.className).toContain(
      "relative flex min-h-0 flex-1 flex-col",
    );
    expect(slot.parentElement).toBe(wrapper);
    expect(slot.className).toContain(
      "pointer-events-none absolute inset-x-0 bottom-0 z-10",
    );
    expect(slot.className).toContain("max-w-4xl");
    expect(wrapper.style.getPropertyValue("--room-composer-h")).toBe("100px");
    expect(scroller.className).toContain(
      "[scroll-padding-bottom:var(--room-composer-h,0px)]",
    );
    expect(scroller.firstElementChild?.className).toContain(
      "pb-[calc(var(--room-composer-h,0px)+var(--spacing)*2)]",
    );
    expect(scroller.firstElementChild?.className).toContain(
      "md:pb-[calc(var(--room-composer-h,0px)+var(--spacing)*3)]",
    );
  });

  it("keeps latest pinned through growing and shrinking composer chrome", () => {
    const { scroller, wrapper, slot } = renderShell();
    scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight - 3;
    act(() => {
      composerHeight = 180;
      observations.get(slot)!();
    });
    expect(wrapper.style.getPropertyValue("--room-composer-h")).toBe("180px");
    expect(scroller.scrollTop).toBe(680);
    act(() => {
      composerHeight = 80;
      observations.get(slot)!();
    });
    expect(scroller.scrollTop).toBe(580);
  });

  it("preserves the history offset when the composer resizes", () => {
    const { scroller, slot } = renderShell();
    scroller.scrollTop = 120;
    act(() => {
      composerHeight = 180;
      observations.get(slot)!();
    });
    expect(scroller.scrollTop).toBe(120);
    act(() => {
      composerHeight = 80;
      observations.get(slot)!();
    });
    expect(scroller.scrollTop).toBe(120);
  });

  it("disconnects the composer observer when the column unmounts", () => {
    const { slot, unmount } = renderShell();
    expect(observations.has(slot)).toBe(true);
    unmount();
    expect(observations.has(slot)).toBe(false);
  });
});
