"use client";

import { useCallback, useSyncExternalStore } from "react";

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
    (onStoreChange: () => void) => {
      if (
        typeof window === "undefined" ||
        typeof window.matchMedia !== "function"
      ) {
        return () => {};
      }
      const mql = window.matchMedia(query);
      if (typeof mql.addEventListener === "function") {
        mql.addEventListener("change", onStoreChange);
        return () => mql.removeEventListener("change", onStoreChange);
      }
      if (typeof mql.addListener === "function") {
        mql.addListener(onStoreChange);
        return () => mql.removeListener(onStoreChange);
      }
      return () => {};
    },
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
