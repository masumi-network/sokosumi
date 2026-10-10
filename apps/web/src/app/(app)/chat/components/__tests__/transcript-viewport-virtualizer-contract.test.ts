import { Virtualizer } from "@tanstack/react-virtual";
import { describe, expect, it, vi } from "vitest";

/**
 * TranscriptViewport delegates measurement compensation to TanStack's
 * built-in anchoring. Browser tests cover iOS touch and real DOM layout.
 */

const VIEWPORT = 600;
const ESTIMATE = 80;
const COUNT = 100;

interface Setup {
  anchorTo?: "start" | "end";
  offset: number;
}

function setup({ anchorTo, offset }: Setup) {
  const element = document.createElement("div");
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, get: () => COUNT * ESTIMATE },
    clientHeight: { configurable: true, get: () => VIEWPORT },
  });
  const scrollToFn = vi.fn();
  const virtualizer = new Virtualizer<HTMLElement, HTMLElement>({
    count: COUNT,
    getScrollElement: () => element,
    estimateSize: () => ESTIMATE,
    anchorTo,
    scrollToFn,
    observeElementRect: (_instance, report) => {
      report({ width: 300, height: VIEWPORT });
    },
    observeElementOffset: (_instance, report) => {
      report(offset, false);
    },
  });
  virtualizer._didMount();
  virtualizer._willUpdate();
  scrollToFn.mockClear();
  return { virtualizer, scrollToFn };
}

describe("the virtualizer behavior TranscriptViewport relies on", () => {
  it("puts the view back after a row above it changed height, unless told not to", () => {
    const { virtualizer, scrollToFn } = setup({ offset: 4000 });

    virtualizer.resizeItem(0, ESTIMATE + 50);

    expect(scrollToFn).toHaveBeenCalledWith(
      4000,
      expect.objectContaining({ adjustments: 50 }),
      virtualizer,
    );
  });

  it("follows measured growth at the live edge", () => {
    const max = COUNT * ESTIMATE - VIEWPORT;
    const { virtualizer, scrollToFn } = setup({
      offset: max,
      anchorTo: "end",
    });

    virtualizer.resizeItem(0, ESTIMATE + 50);

    expect(scrollToFn).toHaveBeenCalledWith(
      max,
      expect.objectContaining({ adjustments: 50 }),
      virtualizer,
    );
  });
});
