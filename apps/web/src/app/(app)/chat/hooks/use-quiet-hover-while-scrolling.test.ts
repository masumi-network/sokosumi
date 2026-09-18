import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHAT_SCROLLING_ATTRIBUTE,
  useQuietHoverWhileScrolling,
} from "./use-quiet-hover-while-scrolling";

function scrollOnce(node: HTMLElement) {
  act(() => {
    node.dispatchEvent(new Event("scroll"));
  });
}

describe("useQuietHoverWhileScrolling", () => {
  let scroller: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    scroller = document.createElement("div");
    document.body.append(scroller);
  });

  afterEach(() => {
    vi.useRealTimers();
    scroller.remove();
  });

  it("marks the scroller while a scroll runs and clears it once it settles", () => {
    renderHook(() => {
      useQuietHoverWhileScrolling(scroller);
    });

    expect(scroller.hasAttribute(CHAT_SCROLLING_ATTRIBUTE)).toBe(false);

    scrollOnce(scroller);
    expect(scroller.hasAttribute(CHAT_SCROLLING_ATTRIBUTE)).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(scroller.hasAttribute(CHAT_SCROLLING_ATTRIBUTE)).toBe(false);
  });

  it("holds the mark across the gaps between momentum bursts", () => {
    renderHook(() => {
      useQuietHoverWhileScrolling(scroller);
    });

    scrollOnce(scroller);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    scrollOnce(scroller);
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // The first burst's timer would have fired by now had the second not
    // pushed it back.
    expect(scroller.hasAttribute(CHAT_SCROLLING_ATTRIBUTE)).toBe(true);
  });

  it("clears the mark and stops listening on unmount", () => {
    const { unmount } = renderHook(() => {
      useQuietHoverWhileScrolling(scroller);
    });

    scrollOnce(scroller);
    unmount();
    expect(scroller.hasAttribute(CHAT_SCROLLING_ATTRIBUTE)).toBe(false);

    scrollOnce(scroller);
    expect(scroller.hasAttribute(CHAT_SCROLLING_ATTRIBUTE)).toBe(false);
  });

  it("does nothing until the scroller mounts", () => {
    const { rerender } = renderHook(
      ({ node }: { node: HTMLElement | null }) => {
        useQuietHoverWhileScrolling(node);
      },
      { initialProps: { node: null as HTMLElement | null } },
    );

    scrollOnce(scroller);
    expect(scroller.hasAttribute(CHAT_SCROLLING_ATTRIBUTE)).toBe(false);

    rerender({ node: scroller });
    scrollOnce(scroller);
    expect(scroller.hasAttribute(CHAT_SCROLLING_ATTRIBUTE)).toBe(true);
  });
});
