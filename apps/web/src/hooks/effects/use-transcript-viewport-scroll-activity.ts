"use client";

import type { Virtualizer } from "@tanstack/react-virtual";
import { type RefObject, useEffect } from "react";

/**
 * A rich-text editor. The one below the transcript is blurred when the
 * reader drags it; the ones inside it (in-row message edit) are left alone.
 * Matched by attribute rather than `isContentEditable` so the rule is the
 * markup React writes.
 */
const EDITOR_SELECTOR = '[contenteditable="true"]';

interface TranscriptViewportScrollActivityParams {
  scroller: HTMLElement | null;
  virtualizer: Virtualizer<HTMLElement, HTMLDivElement>;
  touchingRef: RefObject<boolean>;
  scrollingRef: RefObject<boolean>;
  recordDistance: (element: HTMLElement, corrected?: number) => void;
  followResize: (element: HTMLElement) => boolean;
  onScrollIdle: () => void;
}

/**
 * Tracks scroll, touch, and scroller-resize activity for `TranscriptViewport`,
 * blurs an external composer on touch drag, and signals `onScrollIdle` once
 * scrolling settles.
 */
export function useTranscriptViewportScrollActivity({
  scroller,
  virtualizer,
  touchingRef,
  scrollingRef,
  recordDistance,
  followResize,
  onScrollIdle,
}: TranscriptViewportScrollActivityParams): void {
  useEffect(() => {
    if (!scroller) {
      return;
    }
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      clearTimeout(idleTimer);
      if (touchingRef.current) return;
      // Match TanStack's iOS post-touch grace before changing row positions.
      // Scroll events keep renewing this timer throughout momentum scrolling.
      idleTimer = setTimeout(() => {
        if (virtualizer.isScrolling) {
          settle();
          return;
        }
        scrollingRef.current = false;
        onScrollIdle();
      }, 200);
    };
    const record = () => {
      scrollingRef.current = true;
      recordDistance(scroller);
      settle();
    };
    const touchStart = () => {
      touchingRef.current = true;
      scrollingRef.current = true;
      clearTimeout(idleTimer);
    };
    const touchEnd = () => {
      touchingRef.current = false;
      settle();
    };
    // Dragging the transcript means reading, not typing, so the keyboard
    // gets out of the way. On `touchmove` rather than `scroll`: closing the
    // keyboard changes the viewport and can itself emit scroll events.
    const onTouchMove = () => {
      const active = document.activeElement;
      // Only the composer below the transcript. An editor inside the
      // scroller is an in-row message edit, and scrolling back through the
      // conversation is part of writing that edit, not a reason to end it.
      if (
        active instanceof HTMLElement &&
        active.matches(EDITOR_SELECTOR) &&
        !scroller.contains(active)
      ) {
        active.blur();
      }
    };
    // The virtualizer's onChange runs only when the mounted rows change, and
    // a draft growing a line changes none: watch the scroller itself too.
    // A resize it does not follow still moves the end, so record that.
    const scrollerResize = new ResizeObserver(() => {
      if (!followResize(scroller)) recordDistance(scroller);
    });
    scrollerResize.observe(scroller);
    // An overlaid composer changes list padding without resizing the scroller.
    if (scroller.firstElementChild)
      scrollerResize.observe(scroller.firstElementChild);
    scroller.addEventListener("scroll", record, { passive: true });
    scroller.addEventListener("scrollend", settle, { passive: true });
    scroller.addEventListener("touchstart", touchStart, { passive: true });
    scroller.addEventListener("touchend", touchEnd, { passive: true });
    scroller.addEventListener("touchcancel", touchEnd, { passive: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => {
      clearTimeout(idleTimer);
      scrollerResize.disconnect();
      scroller.removeEventListener("scroll", record);
      scroller.removeEventListener("scrollend", settle);
      scroller.removeEventListener("touchstart", touchStart);
      scroller.removeEventListener("touchend", touchEnd);
      scroller.removeEventListener("touchcancel", touchEnd);
      scroller.removeEventListener("touchmove", onTouchMove);
    };
  }, [scroller, virtualizer]);
}
