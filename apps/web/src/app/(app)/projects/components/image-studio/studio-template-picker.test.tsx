import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_LABELS } from "./studio-fixtures";
import { StudioTemplateCarousel } from "./studio-template-picker";

const mocks = vi.hoisted(() => ({
  reduceMotion: false,
  api: {
    scrollNext: vi.fn(),
    scrollPrev: vi.fn(),
    rootNode: () =>
      document.querySelector<HTMLElement>("[data-slot=carousel-content]")!,
    slideNodes: () =>
      Array.from(
        document.querySelectorAll<HTMLElement>("[data-slot=carousel-item]"),
      ),
    canScrollPrev: () => true,
    canScrollNext: () => true,
    on: vi.fn(),
    off: vi.fn(),
  },
}));

// Embla's measurements need a layout engine. Drive its public navigation seam
// here while exercising the real carousel controls and browser timer cleanup.
vi.mock("embla-carousel-react", () => ({
  default: () => [() => undefined, mocks.api],
}));
vi.mock("motion/react", () => ({ useReducedMotion: () => mocks.reduceMotion }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocks.reduceMotion = false;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mount() {
  const apply = vi.fn();
  const view = render(
    <StudioTemplateCarousel labels={TEST_LABELS} onApplyTemplate={apply} />,
  );
  return { ...view, apply };
}
function advance() {
  act(() => vi.advanceTimersByTime(5000));
}

function hoverStyle(name: string, left: number, width = 300) {
  const button = screen.getByRole("button", { name });
  const item = button.closest("[data-slot=carousel-item]")!;
  const viewport = item.closest("[data-slot=carousel-content]")!;
  vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 900, 200),
  );
  vi.spyOn(item, "getBoundingClientRect").mockReturnValue(
    new DOMRect(left, 0, width, 200),
  );
  fireEvent.mouseEnter(screen.getByRole("region", { name: "templates" }));
  fireEvent.mouseMove(button);
}

describe("the empty studio carousel", () => {
  it("has no navigation buttons or unattended rotation; selecting a style stays explicit", () => {
    const { apply } = mount();
    advance();
    expect(mocks.api.scrollNext).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button")).toHaveLength(14);
    const carousel = screen.getByRole("region", { name: "templates" });
    fireEvent.keyDown(carousel, { key: "ArrowRight" });
    fireEvent.keyDown(carousel, { key: "ArrowLeft" });
    expect(mocks.api.scrollNext).toHaveBeenCalledTimes(1);
    expect(mocks.api.scrollPrev).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "poster" }));
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ id: "poster" }),
    );
  });

  it("suspends hover scrolling during keyboard focus and dragging, then resumes", () => {
    mount();
    hoverStyle("headshot", 600);
    const poster = screen.getByRole("button", { name: "poster" });
    fireEvent.focus(poster);
    advance();
    expect(mocks.api.scrollNext).not.toHaveBeenCalled();
    fireEvent.blur(poster);
    act(() => vi.advanceTimersByTime(300));
    expect(mocks.api.scrollNext).toHaveBeenCalledTimes(1);
    const startDrag = mocks.api.on.mock.calls.find(
      ([event]) => event === "pointerDown",
    )![1];
    const endDrag = mocks.api.on.mock.calls.find(
      ([event]) => event === "pointerUp",
    )![1];
    act(() => startDrag());
    advance();
    expect(mocks.api.scrollNext).toHaveBeenCalledTimes(1);
    act(() => endDrag());
    act(() => vi.advanceTimersByTime(300));
    expect(mocks.api.scrollNext).toHaveBeenCalledTimes(2);
  });

  it("scrolls repeatedly toward the hovered outer card without applying it", () => {
    const { apply } = mount();
    hoverStyle("headshot", 600);
    act(() => vi.advanceTimersByTime(2300));
    expect(mocks.api.scrollNext).toHaveBeenCalledTimes(3);
    expect(mocks.api.scrollPrev).not.toHaveBeenCalled();
    hoverStyle("poster", 0);
    act(() => vi.advanceTimersByTime(1300));
    expect(mocks.api.scrollPrev).toHaveBeenCalledTimes(2);
    expect(mocks.api.scrollNext).toHaveBeenCalledTimes(3);
    expect(apply).not.toHaveBeenCalled();
  });

  it("stops edge scrolling over the center card and when the pointer leaves", () => {
    mount();
    hoverStyle("headshot", 600);
    act(() => vi.advanceTimersByTime(300));
    expect(mocks.api.scrollNext).toHaveBeenCalledTimes(1);
    hoverStyle("poster", 300);
    act(() => vi.advanceTimersByTime(3000));
    expect(mocks.api.scrollNext).toHaveBeenCalledTimes(1);
    hoverStyle("headshot", 600);
    fireEvent.mouseLeave(screen.getByRole("region", { name: "templates" }));
    act(() => vi.advanceTimersByTime(3000));
    expect(mocks.api.scrollNext).toHaveBeenCalledTimes(1);
  });

  it("cleans up edge scrolling on unmount", () => {
    const { unmount } = mount();
    hoverStyle("headshot", 600);
    unmount();
    advance();
    expect(mocks.api.scrollNext).not.toHaveBeenCalled();
    expect(mocks.api.off).toHaveBeenCalledWith(
      "pointerUp",
      expect.any(Function),
    );
  });

  it("keeps the centered preview clear and places neighboring cards behind it", () => {
    mount();
    const viewport = mocks.api.rootNode();
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 900, 400),
    );
    const slides = mocks.api.slideNodes();
    slides.forEach((slide, index) => {
      vi.spyOn(slide, "getBoundingClientRect").mockReturnValue(
        new DOMRect(350 + index * 200, 0, 200, 400),
      );
    });
    const paint = mocks.api.on.mock.calls.find(
      ([event]) => event === "scroll",
    )![1];
    act(() => paint());
    const center = screen.getByRole("button", { name: "poster" });
    const outer = screen.getByRole("button", { name: "product-announcement" });
    expect(center.style.transform).toContain("scale(1)");
    expect(Number(slides[0]!.style.zIndex)).toBeGreaterThan(
      Number(slides[2]!.style.zIndex),
    );
    expect(
      center.querySelector<HTMLElement>("[data-template-preview]")!.style
        .filter,
    ).toBe("blur(0px)");
    expect(
      outer.querySelector<HTMLElement>("[data-template-preview]")!.style.filter,
    ).not.toBe("blur(0px)");
    expect(center.textContent).toBe("poster");
  });

  it("does not hover-scroll with reduced motion and still allows keyboard navigation", () => {
    mocks.reduceMotion = true;
    mount();
    hoverStyle("headshot", 600);
    advance();
    expect(mocks.api.scrollNext).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("region", { name: "templates" }), {
      key: "ArrowRight",
    });
    expect(mocks.api.scrollNext).toHaveBeenCalledTimes(1);
  });
});
