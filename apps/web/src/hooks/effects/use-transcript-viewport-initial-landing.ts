"use client";

import type { Virtualizer } from "@tanstack/react-virtual";
import { type RefObject, useLayoutEffect } from "react";
import type { RoomTranscriptRenderRow } from "@/app/chat/utils/room-transcript-ranges";
import { findTranscriptRowIndex } from "@/app/chat/utils/transcript-viewport-model";

/**
 * How many frames a landing waits for its row to mount after the scroll.
 * The virtualizer re-issues a scroll while rows above the target are still
 * being measured, so the wait covers that.
 */
export const LANDING_FRAMES = 90;

export interface TranscriptPosition {
  anchorId: string | null;
  anchorCreatedAt: number;
  offset: number;
  /**
   * Opens the anchor this share of the scroller's height below its top, on
   * top of `offset`: the Unread divider sits a third of the way down.
   */
  viewportShare?: number;
  atLiveEdge: boolean;
  visibleMessageIds: string[];
}

function retainedPositionIndex(
  rows: readonly RoomTranscriptRenderRow[],
  saved: TranscriptPosition,
): number {
  const exact = saved.anchorId
    ? findTranscriptRowIndex(rows, saved.anchorId)
    : -1;
  if (exact >= 0 || saved.atLiveEdge) return exact;
  let index = -1;
  let nearest = Infinity;
  rows.forEach((row, candidate) => {
    if (row.kind !== "message") return;
    const distance = Math.abs(
      new Date(row.message.createdAt).getTime() - saved.anchorCreatedAt,
    );
    if (distance < nearest) {
      nearest = distance;
      index = candidate;
    }
  });
  return index;
}

/** The row a remount reopens on, or -1 when it opens at the live edge. */
export function openingIndex(
  rows: readonly RoomTranscriptRenderRow[],
  saved: TranscriptPosition | undefined,
): number {
  return saved && !saved.atLiveEdge ? retainedPositionIndex(rows, saved) : -1;
}

export function readTranscriptViewportHeight(scroller: HTMLElement): number {
  const bottomInset =
    Number.parseFloat(getComputedStyle(scroller).scrollPaddingBottom) || 0;
  return Math.max(scroller.clientHeight - bottomInset, 0);
}

interface TranscriptViewportInitialLandingParams {
  openedRef: RefObject<boolean>;
  scroller: HTMLElement | null;
  rows: readonly RoomTranscriptRenderRow[];
  rowsRef: RefObject<readonly RoomTranscriptRenderRow[]>;
  atEnd: boolean;
  updateReach: (
    change: { atEnd: boolean } | { placingLanding: AbortController | null },
  ) => void;
  restoreRef: RefObject<TranscriptPosition | undefined>;
  virtualizer: Virtualizer<HTMLElement, HTMLDivElement>;
  recordDistance: (element: HTMLElement, corrected?: number) => void;
  landingAbort: { start: () => AbortController };
}

/**
 * Places `TranscriptViewport` at the live edge or on a saved reading position,
 * polling frames until the restored anchor settles. Runs on open and again
 * whenever the viewport rearms landing.
 */
export function useTranscriptViewportInitialLanding({
  openedRef,
  scroller,
  rows,
  rowsRef,
  atEnd,
  updateReach,
  restoreRef,
  virtualizer,
  recordDistance,
  landingAbort,
}: TranscriptViewportInitialLandingParams): void {
  useLayoutEffect(() => {
    if (openedRef.current || !scroller) return;
    // A list that cannot scroll never fires a scroll or a measurement, so
    // the opening tells the room where it is: an empty one where it starts.
    if (rows.length === 0) {
      updateReach({ atEnd });
      return;
    }
    openedRef.current = true;
    const saved = restoreRef.current;
    const index = openingIndex(rows, saved);
    if (!saved || index < 0) {
      restoreRef.current = undefined;
      virtualizer.scrollToEnd();
      recordDistance(scroller);
      return;
    }
    virtualizer.scrollToIndex(index, { align: "start" });
    const landing = landingAbort.start();
    let frames = 0;
    let settledFrames = 0;
    const finishRestore = () => {
      if (landing.signal.aborted) return;
      const currentIndex = retainedPositionIndex(rowsRef.current, saved);
      const anchor = scroller.querySelector<HTMLElement>(
        `[data-index="${currentIndex}"]`,
      );
      if (!anchor && currentIndex >= 0 && currentIndex !== index) {
        virtualizer.scrollToIndex(currentIndex, { align: "start" });
      }
      const correction = anchor
        ? anchor.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          saved.offset -
          (saved.viewportShare ?? 0) * readTranscriptViewportHeight(scroller)
        : null;
      // Too little history above or below cannot put the anchor in its
      // place: a scroller already at that edge has gone as far as it can.
      const clamped =
        correction != null &&
        (correction < 0
          ? scroller.scrollTop <= 0
          : scroller.scrollTop >=
            scroller.scrollHeight - scroller.clientHeight - 1);
      if (correction != null && Math.abs(correction) >= 1 && !clamped) {
        virtualizer.scrollBy(correction);
        settledFrames = 0;
      } else {
        settledFrames = correction == null ? 0 : settledFrames + 1;
      }
      if (settledFrames < 3 && ++frames < LANDING_FRAMES) {
        requestAnimationFrame(finishRestore);
        return;
      }
      restoreRef.current = undefined;
      recordDistance(scroller);
    };
    requestAnimationFrame(finishRestore);
  });
}
