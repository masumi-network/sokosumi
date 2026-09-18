import { type VirtualItem, Virtualizer } from "@tanstack/react-virtual";
import { describe, expect, it, vi } from "vitest";

/**
 * `TranscriptViewport` leans on virtualizer behavior its docs do not
 * promise. Each test here pins one piece of it, so an upgrade that changes
 * one fails here instead of as a transcript that jumps on a phone.
 */

const VIEWPORT = 600;
const ESTIMATE = 80;
const COUNT = 100;

interface Setup {
  /** Passed as an option, which the library is expected to ignore. */
  optionHook?: () => boolean;
  /** Set on the instance, which is what the library reads. */
  instanceHook?: Virtualizer<
    HTMLElement,
    HTMLElement
  >["shouldAdjustScrollPositionOnItemSizeChange"];
  anchorTo?: "start" | "end";
  offset: number;
}

function setup({ optionHook, instanceHook, anchorTo, offset }: Setup) {
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
    ...(optionHook
      ? { shouldAdjustScrollPositionOnItemSizeChange: optionHook }
      : {}),
  });
  if (instanceHook) {
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = instanceHook;
  }
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

  it("reads the veto from the instance, and asks before the new size is cached", () => {
    const seen: { item: VirtualItem; delta: number; measured: boolean }[] = [];
    const { virtualizer, scrollToFn } = setup({
      offset: 4000,
      instanceHook: (item, delta, instance) => {
        seen.push({
          item,
          delta,
          measured: instance.itemSizeCache.has(item.key),
        });
        return false;
      },
    });

    virtualizer.resizeItem(0, ESTIMATE + 50);
    virtualizer.resizeItem(0, ESTIMATE + 70);

    expect(scrollToFn).not.toHaveBeenCalled();
    expect(seen.map(({ delta, measured }) => ({ delta, measured }))).toEqual([
      { delta: 50, measured: false },
      { delta: 20, measured: true },
    ]);
    expect(seen[0]?.item).toMatchObject({ index: 0, start: 0, end: ESTIMATE });
  });

  it("ignores the same veto passed as an option", () => {
    const optionHook = vi.fn(() => false);
    const { virtualizer, scrollToFn } = setup({ offset: 4000, optionHook });

    virtualizer.resizeItem(0, ESTIMATE + 50);

    expect(optionHook).not.toHaveBeenCalled();
    expect(scrollToFn).toHaveBeenCalled();
  });

  it("skips the veto at the live edge and hands the growth over as adjustments", () => {
    // `scrollBottomAnchored` drops `adjustments`; this is the call it drops
    // them from. The offset is the one from before the growth.
    const max = COUNT * ESTIMATE - VIEWPORT;
    const { virtualizer, scrollToFn } = setup({
      offset: max,
      anchorTo: "end",
      instanceHook: () => false,
    });

    virtualizer.resizeItem(0, ESTIMATE + 50);

    expect(scrollToFn).toHaveBeenCalledWith(
      max,
      expect.objectContaining({ adjustments: 50 }),
      virtualizer,
    );
  });

  it("takes a scroll offset written from outside as where the view is", () => {
    const { virtualizer } = setup({ offset: 0 });
    expect(virtualizer.getVirtualItems()[0]?.index).toBe(0);

    virtualizer.scrollOffset = 50 * ESTIMATE;

    const indexes = virtualizer.getVirtualItems().map((item) => item.index);
    expect(indexes).toContain(50);
    expect(indexes).not.toContain(0);
  });
});
