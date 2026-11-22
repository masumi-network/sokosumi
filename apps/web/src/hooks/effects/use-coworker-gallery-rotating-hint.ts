"use client";

import { useEffect, useState } from "react";

/**
 * Cycles the rotating search placeholder hint index every 3 seconds for
 * `CoworkerGallerySearch` unless there is at most one hint or reduced motion
 * is preferred.
 */
export function useCoworkerGalleryRotatingHint(
  hintCount: number,
  reduceMotion: boolean,
): number {
  const [hintIdx, setHintIdx] = useState(0);

  useEffect(() => {
    if (hintCount <= 1 || reduceMotion) return;
    const id = window.setInterval(
      () => setHintIdx((index) => (index + 1) % hintCount),
      3000,
    );
    return () => window.clearInterval(id);
  }, [reduceMotion, hintCount]);

  return hintIdx;
}
