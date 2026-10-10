import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectStudioCarouselSlides,
  paintStudioCarouselDepth,
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
  });
});
