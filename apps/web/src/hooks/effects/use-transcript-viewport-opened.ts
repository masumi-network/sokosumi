"use client";

import { startTransition, useEffect, useState } from "react";

/**
 * Defers deep overscan in `TranscriptViewport` until the animation frame after
 * the first rows paint once `scroller` is attached.
 */
export function useTranscriptViewportOpened(
  scroller: HTMLElement | null,
): boolean {
  // Deep overscan waits for the frame after the first rows paint.
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (!scroller || opened) return;
    const frame = requestAnimationFrame(() => {
      startTransition(() => setOpened(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [opened, scroller]);

  return opened;
}
