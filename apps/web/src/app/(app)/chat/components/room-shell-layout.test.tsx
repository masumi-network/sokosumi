import { act, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RoomShellLayout } from "./room-shell-layout";

const observations = new Map<Element, () => void>();
let composerHeight = 100;
let cardTop = 12;
let cardHeight = 64;
let scrollbarWidth = 12;

beforeEach(() => {
  composerHeight = 100;
  cardTop = 12;
  cardHeight = 64;
  scrollbarWidth = 12;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: () => void) {}
      observe(target: Element) {
        observations.set(target, this.callback);
      }
      unobserve(target: Element) {
        observations.delete(target);
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
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    () => 900 - scrollbarWidth,
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute("data-room-composer-mention-anchor")
        ? new DOMRect(0, 400 + cardTop, 800, cardHeight)
        : new DOMRect(0, 400, 800, composerHeight);
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  observations.clear();
});

function renderShell(readOnly = false) {
  const scrollerRef = createRef<HTMLDivElement>();
  const result = render(
    <RoomShellLayout
      listScrollerRef={scrollerRef}
      listContent={<button type="button">Message</button>}
      composer={
        <div data-testid="composer">
          {readOnly ? (
            <p>Read-only notice</p>
          ) : (
            <div data-room-composer-mention-anchor>Composer</div>
          )}
        </div>
      }
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

  it("fades the whole scroll area below the card's middle without covering the native scrollbar", () => {
    const { scroller, wrapper, slot, container } = renderShell();
    const fade = container.querySelector("[data-room-composer-fade]");
    expect(fade?.parentElement).toBe(wrapper);
    expect(scroller.nextElementSibling).toBe(fade);
    expect(fade?.nextElementSibling).toBe(slot);
    expect(scroller).toHaveClass("relative", "z-0");
    expect(fade).toHaveClass(
      "pointer-events-none",
      "absolute",
      "start-0",
      "end-[var(--room-scrollbar-w,0px)]",
      "bottom-0",
      "z-0",
      "h-[var(--room-composer-h,0px)]",
    );
    expect(fade).not.toHaveClass("max-w-4xl");
    expect(fade).toHaveAttribute("aria-hidden", "true");
    expect(fade?.getAttribute("style")).toContain(
      "linear-gradient(to bottom, transparent var(--room-composer-fade-start,50%), var(--background) var(--room-composer-fade-end,100%))",
    );
    expect(slot).toHaveClass("z-10");
    expect(wrapper.style.getPropertyValue("--room-composer-fade-start")).toBe(
      "44px",
    );
    expect(wrapper.style.getPropertyValue("--room-composer-fade-end")).toBe(
      "76px",
    );
    expect(wrapper.style.getPropertyValue("--room-scrollbar-w")).toBe("12px");
    expect(scroller.style.maskImage).toBe("");
  });

  it("tracks the card beneath tall trays and changes its stops even when total height stays the same", () => {
    const { wrapper, slot, container } = renderShell();
    const card = container.querySelector(
      "[data-room-composer-mention-anchor]",
    )!;
    act(() => {
      composerHeight = 260;
      cardTop = 172;
      observations.get(slot)!();
    });
    expect(wrapper.style.getPropertyValue("--room-composer-fade-start")).toBe(
      "204px",
    );
    expect(wrapper.style.getPropertyValue("--room-composer-fade-end")).toBe(
      "236px",
    );
    act(() => {
      cardTop = 136;
      cardHeight = 100;
      observations.get(card)!();
    });
    expect(wrapper.style.getPropertyValue("--room-composer-fade-start")).toBe(
      "186px",
    );
    expect(wrapper.style.getPropertyValue("--room-composer-fade-end")).toBe(
      "236px",
    );
  });

  it("keeps the fade inside the reserved padding through safe-area and scrollbar changes", () => {
    const { scroller, wrapper, slot } = renderShell();
    act(() => {
      composerHeight = 134;
      observations.get(slot)!();
    });
    expect(wrapper.style.getPropertyValue("--room-composer-h")).toBe("134px");
    expect(wrapper.style.getPropertyValue("--room-composer-fade-end")).toBe(
      "76px",
    );
    act(() => {
      composerHeight = 76;
      scrollbarWidth = 0;
      observations.get(scroller)!();
    });
    expect(wrapper.style.getPropertyValue("--room-composer-h")).toBe("76px");
    expect(wrapper.style.getPropertyValue("--room-composer-fade-end")).toBe(
      "76px",
    );
    expect(wrapper.style.getPropertyValue("--room-scrollbar-w")).toBe("0px");
  });

  it("keeps a read-only notice above a fade based on its slot bounds", () => {
    const { wrapper, slot } = renderShell(true);
    expect(slot).toHaveClass("z-10");
    expect(wrapper.style.getPropertyValue("--room-composer-fade-start")).toBe(
      "50px",
    );
    expect(wrapper.style.getPropertyValue("--room-composer-fade-end")).toBe(
      "100px",
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
