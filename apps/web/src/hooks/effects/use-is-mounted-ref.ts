"use client";

import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

/**
 * Tracks whether the component is currently mounted and active (passive effect
 * timing, flipping `false` on unmount or React `<Activity>` hide). Use to guard
 * late side effects after un-abortable async calls (such as Server Actions).
 */
export function useIsMountedRef(): RefObject<boolean> {
  const ref = useRef(false);

  useEffect(() => {
    ref.current = true;
    return () => {
      ref.current = false;
    };
  }, []);

  return ref;
}

/**
 * Tracks whether the component is currently mounted and active with layout
 * effect timing (initial `true`, flipping `false` before paint on unmount or
 * React `<Activity>` hide).
 */
export function useLayoutIsMountedRef(): RefObject<boolean> {
  const ref = useRef(true);

  useLayoutEffect(() => {
    ref.current = true;
    return () => {
      ref.current = false;
    };
  }, []);

  return ref;
}
