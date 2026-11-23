"use client";

import { useLayoutEffect } from "react";

export interface ClampedOverflowState {
  cacheKey: string;
  resetKey: string;
  expanded: boolean;
  overflows: boolean;
}

/**
 * Syncs the latest disclosure state for `useClampedOverflow` into the
 * transcript's cache map before paint so remounting virtualized rows restore
 * their previous state before measurement.
 */
export function useClampedOverflowCacheSync(
  states: Map<string, ClampedOverflowState> | null,
  cacheKey: string,
  current: ClampedOverflowState,
): void {
  // Keep only the latest version per body or quote, including when no text
  // element is mounted (for example, a message containing only jumbo emoji).
  useLayoutEffect(() => {
    states?.set(cacheKey, current);
  }, [cacheKey, current, states]);
}
