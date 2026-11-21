"use client";

import { useEffect, useState } from "react";

/**
 * Flips a newly mounted task activity row into its entered state on the next
 * animation frame, cancelling the pending frame on unmount.
 */
export function useTaskActivityRowEnter(): boolean {
  const [isEntered, setIsEntered] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setIsEntered(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  return isEntered;
}
