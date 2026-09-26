import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

    // The window is a tuning number, so bracket it rather than pin it: long
    // enough that the pill does not flash back between two wheel ticks, short
    // enough that it returns while the pointer is still where it was left.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(scroller.hasAttribute(CHAT_SCROLLING_ATTRIBUTE)).toBe(true);

    act(() => {
      vi.advanceTimersByTime(200);
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

  it("leaves a pill the reader is using out of the scroll rule", () => {
    // Unlayered CSS outweighs the pill's own utilities, so the exceptions can
    // only live in the rule itself. Read it back from the stylesheet: nothing
    // else would catch a selector edit that drops one.
    const selector = readFileSync(
      resolve(process.cwd(), "src/app/globals.css"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\s+/g, " ")
      .replace(/ ?([(){]) ?/g, "$1");

    expect(selector).toContain(
      `[${CHAT_SCROLLING_ATTRIBUTE}] [data-message-actions="hover"]:not(:focus-within):not(:has([aria-expanded="true"])){`,
    );
    expect(selector).not.toContain(
      `[${CHAT_SCROLLING_ATTRIBUTE}] [data-message-actions="hover"]{`,
    );
  });
});
