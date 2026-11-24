"use client";

import { type RefObject, useLayoutEffect, useRef } from "react";

/**
 * Tracks whether a keyed `TasksBoard` instance is currently committed and
 * visible before paint, clearing on unmount or React `<Activity>` hide so
 * late-settling drags and page loads do not toast or mutate after departure.
 */
export function useTasksBoardAlive(): RefObject<boolean> {
  const aliveRef = useRef(false);
  useLayoutEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  return aliveRef;
}
