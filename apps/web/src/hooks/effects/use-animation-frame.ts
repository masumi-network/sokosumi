"use client";

import { useEffect, useEffectEvent } from "react";

/**
 * Runs a `requestAnimationFrame` loop while `active` is true, passing elapsed
 * seconds since the previous frame. The first frame anchors the clock so
 * pausing and resuming never produces a jump.
 */
export function useAnimationFrame(
  active: boolean,
  onFrame: (deltaSeconds: number) => void,
): void {
  const handleFrame = useEffectEvent(onFrame);

  useEffect(() => {
    if (!active) return;

    let frame = 0;
    let lastTime: number | null = null;

    function tick(time: number) {
      if (lastTime !== null) {
        handleFrame((time - lastTime) / 1000);
      }
      lastTime = time;
      frame = requestAnimationFrame(tick);
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active]);
}
