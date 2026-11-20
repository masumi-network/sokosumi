"use client";

import { useEffect } from "react";

/**
 * Revokes an object URL when replaced by another URL, cleared, or unmounted.
 */
export function useRevokeObjectUrl(url: string | null | undefined): void {
  useEffect(() => {
    if (!url) return;
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [url]);
}
