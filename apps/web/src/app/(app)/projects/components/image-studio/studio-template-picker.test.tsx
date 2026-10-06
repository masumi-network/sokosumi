import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_LABELS } from "./studio-fixtures";
import { StudioTemplateCarousel } from "./studio-template-picker";

const mocks = vi.hoisted(() => ({
  reduceMotion: false,
  api: {
    scrollNext: vi.fn(),
    scrollPrev: vi.fn(),
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
  it("rotates and navigates without applying a prompt; picking a style stays explicit", () => {
    const { apply } = mount();
    advance();
    expect(mocks.api.scrollNext).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "nextTemplate" }));
    fireEvent.click(screen.getByRole("button", { name: "previousTemplate" }));
    expect(mocks.api.scrollNext).toHaveBeenCalledTimes(2);
    expect(mocks.api.scrollPrev).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "poster" }));
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ id: "poster" }),
    );
  });

  it("pauses on hover, stops on focus, and restarts only when requested", () => {
    mount();
    const carousel = screen.getByRole("region", { name: "templates" });
    fireEvent.mouseEnter(carousel);
    advance();
    expect(mocks.api.scrollNext).not.toHaveBeenCalled();
    fireEvent.mouseLeave(carousel);
    advance();
    expect(mocks.api.scrollNext).toHaveBeenCalledTimes(1);
    fireEvent.focus(screen.getByRole("button", { name: "poster" }));
    fireEvent.blur(screen.getByRole("button", { name: "poster" }));
    advance();
    expect(mocks.api.scrollNext).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", { name: "startTemplateRotation" }),
    );
    advance();
    expect(mocks.api.scrollNext).toHaveBeenCalledTimes(2);
    fireEvent.click(
      screen.getByRole("button", { name: "pauseTemplateRotation" }),
    );
    advance();
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

  it("cleans up edge scrolling on unmount and respects pause and reduced motion", () => {
    const { unmount } = mount();
    hoverStyle("headshot", 600);
    fireEvent.click(
      screen.getByRole("button", { name: "pauseTemplateRotation" }),
    );
    advance();
    expect(mocks.api.scrollNext).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "startTemplateRotation" }),
    );
    unmount();
    advance();
    expect(mocks.api.scrollNext).not.toHaveBeenCalled();

    mocks.reduceMotion = true;
    mount();
    hoverStyle("headshot", 600);
    advance();
    expect(mocks.api.scrollNext).not.toHaveBeenCalled();
  });

  it("does not rotate with reduced motion and still allows navigation", () => {
    mocks.reduceMotion = true;
    mount();
    advance();
    expect(mocks.api.scrollNext).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "pauseTemplateRotation" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "nextTemplate" }));
    expect(mocks.api.scrollNext).toHaveBeenCalledTimes(1);
  });

  it("cleans up rotation when the gallery replaces it", () => {
    const { unmount } = mount();
    unmount();
    advance();
    expect(mocks.api.scrollNext).not.toHaveBeenCalled();
    expect(mocks.api.off).toHaveBeenCalledWith(
      "pointerDown",
      expect.any(Function),
    );
  });
});
