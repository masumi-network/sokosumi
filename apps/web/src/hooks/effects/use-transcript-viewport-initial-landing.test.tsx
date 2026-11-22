import type { Virtualizer } from "@tanstack/react-virtual";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RoomTranscriptRenderRow } from "@/app/chat/utils/room-transcript-ranges";
import {
  type TranscriptPosition,
  useTranscriptViewportInitialLanding,
} from "./use-transcript-viewport-initial-landing";

function makeVirtualizer() {
  return {
    scrollToEnd: vi.fn(),
    scrollToIndex: vi.fn(),
    scrollBy: vi.fn(),
  } as unknown as Virtualizer<HTMLElement, HTMLDivElement>;
}

describe("useTranscriptViewportInitialLanding", () => {
  it("reports reach for an empty list and scrolls to end once when opening at live edge", () => {
    const scroller = document.createElement("div");
    const virtualizer = makeVirtualizer();
    const openedRef = { current: false };
    const restoreRef: { current: TranscriptPosition | undefined } = {
      current: undefined,
    };
    const rowsRef: { current: readonly RoomTranscriptRenderRow[] } = {
      current: [],
    };
    const updateReach = vi.fn();
    const recordDistance = vi.fn();
    const landingAbort = { start: vi.fn(() => new AbortController()) };

    function Probe({ rows }: { rows: readonly RoomTranscriptRenderRow[] }) {
      rowsRef.current = rows;
      useTranscriptViewportInitialLanding({
        openedRef,
        scroller,
        rows,
        rowsRef,
        atEnd: true,
        updateReach,
        restoreRef,
        virtualizer,
        recordDistance,
        landingAbort,
      });
      return null;
    }

    const { rerender, unmount } = render(<Probe rows={[]} />);
    expect(updateReach).toHaveBeenCalledExactlyOnceWith({ atEnd: true });
    expect(openedRef.current).toBe(false);

    const row = {
      kind: "message",
      message: { id: "m1", createdAt: "2026-11-20T00:00:00Z" },
    } as unknown as RoomTranscriptRenderRow;
    rerender(<Probe rows={[row]} />);
    expect(openedRef.current).toBe(true);
    expect(virtualizer.scrollToEnd).toHaveBeenCalledOnce();
    expect(recordDistance).toHaveBeenCalledExactlyOnceWith(scroller);

    // Subsequent rerenders are a no-op once openedRef is true.
    rerender(<Probe rows={[row]} />);
    expect(virtualizer.scrollToEnd).toHaveBeenCalledOnce();

    unmount();
  });
});
