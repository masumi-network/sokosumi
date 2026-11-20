"use client";

import { type RefObject, useLayoutEffect, useRef } from "react";

/**
 * Holds the latest committed value in a ref, updated in a layout effect so a
 * discarded concurrent render never overwrites it and callbacks outside
 * React's effect scope can read it without calling `useEffectEvent` outside an
 * effect.
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
