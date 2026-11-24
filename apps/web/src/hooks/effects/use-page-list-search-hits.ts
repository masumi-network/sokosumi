"use client";

import { useEffect } from "react";

type PageListSearchRegister = (hits: number, hasMore: boolean) => () => void;

/**
 * Registers a list's current search hit count with `PageListSearchContext` and
 * cleans up on count change or unmount.
 */
export function usePageListSearchHits(
  register: PageListSearchRegister | undefined,
  hits: number,
): void {
  useEffect(() => register?.(hits, false), [register, hits]);
}
