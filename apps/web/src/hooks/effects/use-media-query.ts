"use client";

import { useCallback, useSyncExternalStore } from "react";

export const REDUCED_MOTION_MEDIA_QUERY = "(prefers-reduced-motion: reduce)";

export function matchesMediaQuery(query: string, fallback = false): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return fallback;
  }
  return window.matchMedia(query).matches;
}

export function subscribeMediaQuery(
  query: string,
  onChange: () => void,
): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return () => {};
  }
  const mql = window.matchMedia(query);
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }
  if (typeof mql.addListener === "function") {
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }
  return () => {};
}

export function useMediaQuery(query: string): boolean;
export function useMediaQuery<T extends boolean | null | undefined>(
  query: string,
  serverSnapshot: T,
): boolean | T;
export function useMediaQuery(
  query: string,
  ...rest: [serverSnapshot?: boolean | null | undefined]
): boolean | null | undefined {
  const serverSnapshot = rest.length === 0 ? false : rest[0];
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeMediaQuery(query, onStoreChange),
    [query],
  );

  const getSnapshot = useCallback(
    () =>
      typeof window === "undefined" || typeof window.matchMedia !== "function"
        ? serverSnapshot
        : window.matchMedia(query).matches,
    [query, serverSnapshot],
  );

  const getServerSnapshot = useCallback(() => serverSnapshot, [serverSnapshot]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Live `prefers-reduced-motion: reduce` match via `useSyncExternalStore`.
 * Preferred over `motion/react`'s `useReducedMotion`, which caches a single
 * module-level check, does not re-render on live changes, and warns in dev/test.
 */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_MEDIA_QUERY);
}
