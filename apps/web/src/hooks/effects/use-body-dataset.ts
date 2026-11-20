"use client";

import { useEffect } from "react";

/**
 * Sets `document.body.dataset[key]` while mounted (and while visible under
 * React `<Activity>`), removing it on cleanup or when `value` is nullish.
 */
export function useBodyDataset(
  key: string,
  value: string | null | undefined,
): void {
  useEffect(() => {
    if (value == null) return;
    document.body.dataset[key] = value;
    return () => {
      delete document.body.dataset[key];
    };
  }, [key, value]);
}
