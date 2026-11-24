"use client";

import { useEffect } from "react";

type PageListSearchRegister = (hits: number, hasMore: boolean) => () => void;

/**
 * Registers that a paginated list still has unloaded pages while `partial` is
 * true, and clears the marker when paging finishes or on unmount.
 */
export function usePageSearchPartialMarker(
  register: PageListSearchRegister | undefined,
  partial: boolean,
): void {
  useEffect(
    () => (partial ? register?.(0, true) : undefined),
    [partial, register],
  );
}
