"use client";

import { useEffect } from "react";

/**
 * Replaces `window.location` once `url` becomes non-null.
 *
 * Keeps the current route off browser history so Back cannot bounce-loop.
 */
export function useLocationReplace(url: string | null): void {
  useEffect(() => {
    if (!url) return;
    window.location.replace(url);
  }, [url]);
}
