import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectStudioCarouselSlides,
  paintStudioCarouselDepth,
  STUDIO_DRAGGING_ATTR,
  STUDIO_SELECT_NONE_CLASS,
  STUDIO_SNAP_TARGET_ATTR,
  setStudioCarouselDragging,
  studioCarouselRoot,
} from "./studio-carousel-paint";

function slideAt(left: number, width = 200) {
  const slide = document.createElement("div");
  const card = document.createElement("button");
  card.setAttribute("data-template-card", "");
  const preview = document.createElement("span");
  preview.setAttribute("data-template-preview", "");
  preview.style.filter = "blur(4px)";
  card.append(preview);
  slide.append(card);
  vi.spyOn(slide, "getBoundingClientRect").mockReturnValue(
    new DOMRect(left, 0, width, 400),
  );
  return { slide, card, preview };
}

afterEach(() => {
  document.body.classList.remove(STUDIO_SELECT_NONE_CLASS);
  vi.restoreAllMocks();
});

describe("empty-studio carousel paint", () => {
  it("caches card and preview nodes so a later paint does not query again", () => {
    const { slide } = slideAt(350);
    const query = vi.spyOn(slide, "querySelector");
    const collected = collectStudioCarouselSlides([slide]);
    expect(query).toHaveBeenCalledTimes(2);
    query.mockClear();
    paintStudioCarouselDepth({
      viewport: new DOMRect(0, 0, 900, 400),
      slides: collected,
      reduceMotion: false,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("writes transforms without a blur filter and keeps the centre card sharp", () => {
    const center = slideAt(350);
    const outer = slideAt(750);
    paintStudioCarouselDepth({
      viewport: new DOMRect(0, 0, 900, 400),
      slides: [center, outer],
      reduceMotion: false,
    });
    expect(center.card.style.transform).toContain("scale(1)");
    expect(center.preview.style.filter).toBe("");
    expect(outer.preview.style.filter).toBe("");
    expect(Number(center.preview.style.opacity)).toBeGreaterThan(
      Number(outer.preview.style.opacity),
    );
    expect(Number(center.slide.style.zIndex)).toBeGreaterThan(
      Number(outer.slide.style.zIndex),
    );
    expect(center.card.hasAttribute(STUDIO_SNAP_TARGET_ATTR)).toBe(true);
    expect(outer.card.hasAttribute(STUDIO_SNAP_TARGET_ATTR)).toBe(false);
  });

  it("clears snap targets when motion is reduced", () => {
    const center = slideAt(350);
    center.card.setAttribute(STUDIO_SNAP_TARGET_ATTR, "");
    paintStudioCarouselDepth({
      viewport: new DOMRect(0, 0, 900, 400),
      slides: [center],
      reduceMotion: true,
    });
    expect(center.card.hasAttribute(STUDIO_SNAP_TARGET_ATTR)).toBe(false);
  });

  it("sets a drag flag and will-change, then clears both", () => {
    const center = slideAt(350);
    const root = document.createElement("div");
    const slides = collectStudioCarouselSlides([center.slide]);
    const selection = window.getSelection();
    const removeAllRanges = selection
      ? vi.spyOn(selection, "removeAllRanges")
      : vi.fn();
    setStudioCarouselDragging(root, slides, true);
    expect(root.hasAttribute(STUDIO_DRAGGING_ATTR)).toBe(true);
    expect(center.card.style.willChange).toBe("transform");
    expect(document.body).toHaveClass(STUDIO_SELECT_NONE_CLASS);
    expect(removeAllRanges).toHaveBeenCalled();
    setStudioCarouselDragging(root, slides, false);
    expect(root.hasAttribute(STUDIO_DRAGGING_ATTR)).toBe(false);
    expect(center.card.style.willChange).toBe("");
    expect(document.body).not.toHaveClass(STUDIO_SELECT_NONE_CLASS);
  });

  it("uses the carousel region when present and the viewport otherwise", () => {
    const region = document.createElement("div");
    region.setAttribute("data-slot", "carousel");
    const viewport = document.createElement("div");
    region.append(viewport);
    expect(studioCarouselRoot(viewport)).toBe(region);
    const orphan = document.createElement("div");
    expect(studioCarouselRoot(orphan)).toBe(orphan);
  });
});
