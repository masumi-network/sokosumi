"use client";

import { useEffect } from "react";

/**
 * Sets a CSS custom property on `document.documentElement` while mounted
 * (and while visible under React `<Activity>`), removing it on cleanup or
 * when `value` is nullish.
 */
export function useRootCssVariable(
  name: string,
  value: string | null | undefined,
): void {
  useEffect(() => {
    if (value == null) return;
    const root = document.documentElement;
    root.style.setProperty(name, value);
    return () => {
      root.style.removeProperty(name);
    };
  }, [name, value]);
}
