"use client";

import { type RefObject, useLayoutEffect, useRef } from "react";

/**
 * Tracks whether `useSeoConnection` is currently mounted and active before
 * paint, clearing on unmount or React `<Activity>` hide and restoring on reveal.
 */
export function useSeoConnectionAlive(): RefObject<boolean> {
  const alive = useRef(true);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}
