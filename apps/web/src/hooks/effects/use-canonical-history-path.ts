"use client";

import { useEffect } from "react";

/**
 * Rewrites `window.location.pathname` to `targetPathname` via
 * `window.history.replaceState`, preserving `history.state`, `search`, and
 * `hash`.
 *
 * Runs after every render: a router refresh writes the router's own URL back
 * into history when it commits, so the rewrite must follow it.
 */
export function useCanonicalHistoryPath(targetPathname: string | null): void {
  useEffect(() => {
    if (!targetPathname) return;
    if (window.location.pathname === targetPathname) return;

    const { search, hash } = window.location;
    window.history.replaceState(
      window.history.state,
      "",
      `${targetPathname}${search}${hash}`,
    );
  });
}
